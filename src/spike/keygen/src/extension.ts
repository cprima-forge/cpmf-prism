import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getMachineId, fingerprintFromMachineId } from './machine';
import { readLicenseKey, saveLicenseKey, getLicenseKeyPath, validateLicense, activateMachine, deactivateMachine, ValidationResult } from './license';
import { checkTrial, startTrial, TrialStatus } from './trial';
import { localAppDataDir, appendLog } from './storage';
import { getOrchestratorData, OrchestratorLicense, OrchestratorUser } from './orchestrator';
import { buildSnapshot, snapshotToText, RuntimeSnapshot, HostType, CpmfExtension } from './diagnostics';
import { validateSnapshot, buildSchemaSnapshot } from './schema-validator';
import { RuntimeTreeProvider } from './treeview';

const EXT_ID     = 'cpmf-keygen-spike';
const TRIAL_DAYS = 14;

let _log: vscode.OutputChannel;
let _bar: vscode.StatusBarItem;
let _tree: RuntimeTreeProvider;
let _orchLicense: OrchestratorLicense | null = null;
let _orchUser: OrchestratorUser | null = null;
let _host: HostType = null;

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg: string): void {
    const line = `[${new Date().toISOString()}] ${msg}`;
    _log.appendLine(line);
    appendLog(path.join(localAppDataDir(), 'logs'), msg);
}

// ── Status bar ────────────────────────────────────────────────────────────────

type BarColor = 'green' | 'yellow' | 'red';

const SOL = { green: '#859900', yellow: '#b58900', red: '#dc322f' };

function makeTooltip(header: string, lines: string[]): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;
    md.appendMarkdown(`**${header}**`);
    for (const line of lines) {
        md.appendMarkdown(`\n\n${line}`);
    }
    return md;
}

function setBar(text: string, color: BarColor, tooltip?: string | vscode.MarkdownString, command?: string): void {
    _bar.text    = text;
    _bar.color   = color === 'green' ? SOL.green : color === 'red' ? SOL.red : SOL.yellow;
    _bar.tooltip = tooltip;
    _bar.command = command ?? `${EXT_ID}.licenseStatus`;
    _bar.show();
}

// ── CPMForge extension inventory ─────────────────────────────────────────────

function collectCpmfExtensions(license: ValidationResult | null): CpmfExtension[] {
    return vscode.extensions.all
        .filter(e => e.id.startsWith('cpmforge.'))
        .map(e => {
            const id      = e.id as string;
            const version = (e.packageJSON as Record<string, unknown>)?.version as string ?? 'unknown';
            const isThis  = id === `cpmforge.${EXT_ID}`;
            return {
                id,
                version,
                keygen_license: (isThis && license) ? {
                    valid:      license.valid,
                    expires_at: license.expiry ?? null,
                } : null,
            };
        });
}

// ── Snapshot refresh ──────────────────────────────────────────────────────────

function refreshTree(
    machineId: string,
    license: ValidationResult | null,
    trial: TrialStatus | null,
): RuntimeSnapshot {
    const snap   = buildSnapshot(machineId, vscode.version, _host, collectCpmfExtensions(license), license, trial, _orchLicense, _orchUser);
    const report = validateSnapshot(snap);
    if (!report.valid) {
        log(`[schema] INVALID (${report.errors.length} error(s)): ${report.errors.join(' | ')}`);
    } else {
        log('[schema] valid');
    }
    _tree.update(snap, report);
    return snap;
}

// ── License check flow ────────────────────────────────────────────────────────

async function runLicenseCheck(
    machineId: string,
): Promise<{ license: ValidationResult | null; trial: TrialStatus | null }> {
    const fingerprint = fingerprintFromMachineId(machineId);
    const key         = readLicenseKey();
    let license: ValidationResult | null = null;

    if (key) {
        license = await validateLicense(key, fingerprint, log);

        // Machine not yet activated on Keygen — activate then re-validate (once only)
        if (!license.valid && license.code === 'FINGERPRINT_SCOPE_MISMATCH' && license.licenseId) {
            log('[activation] fingerprint not activated — activating machine');
            const act = await activateMachine(license.licenseId, key, fingerprint, machineId.slice(0, 8), log);
            if (act.ok) {
                license = await validateLicense(key, fingerprint, log);
            }
        }

        if (license.valid) {
            const expDate = license.expiry ? new Date(license.expiry) : null;
            const expStr  = expDate
                ? expDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
                : 'never';
            setBar(`$(verified-filled) CPMForge`, 'green', makeTooltip(
                '$(verified-filled) CPMForge — Licensed',
                [`Expires: \`${expStr}\``, `Machines: ${license.machineCount ?? '?'} / ${license.maxMachines ?? '?'}`],
            ));
            log('[activation] state=licensed');
            refreshTree(machineId, license, null);
            return { license, trial: null };
        }
        log(`[activation] key invalid: ${license.code} ${license.message}`);
        void vscode.window.showWarningMessage(`CPMForge license invalid: ${license.message}`);
    }

    const trial = checkTrial(machineId, log);

    if (trial.tampered) {
        log(`[activation] tampered: ${trial.tamperedSources.join(', ')}`);
        setBar('$(unverified) CPMForge', 'red', makeTooltip(
            '$(unverified) CPMForge — Tampered',
            [`Sources: ${trial.tamperedSources.join(', ')}`, 'License store integrity check failed.'],
        ));
        refreshTree(machineId, license, trial);
        void vscode.window.showErrorMessage(
            `CPMForge: license store tampered (${trial.tamperedSources.join(', ')}). Features disabled.`,
        );
        return { license, trial };
    }

    if (trial.trialStart === null) {
        startTrial(machineId, log);
        const freshTrial = checkTrial(machineId, log);
        setBar(`$(unverified) CPMForge`, 'yellow', makeTooltip(
            '$(unverified) CPMForge — Trial',
            [`${TRIAL_DAYS} days remaining`, 'Click to enter a license key.'],
        ), `${EXT_ID}.enterKey`);
        refreshTree(machineId, license, freshTrial);
        void vscode.window.showInformationMessage(
            `CPMForge trial started — ${TRIAL_DAYS} days. Enter a key to activate.`,
            'Enter Key',
        ).then(sel => { if (sel === 'Enter Key') void vscode.commands.executeCommand(`${EXT_ID}.enterKey`); });
        log('[activation] state=trial-started');
        return { license, trial: freshTrial };
    }

    if (trial.active) {
        setBar(`$(unverified) CPMForge`, 'yellow', makeTooltip(
            '$(unverified) CPMForge — Trial',
            [`${trial.daysRemaining} days remaining`, 'Click to enter a license key.'],
        ), `${EXT_ID}.enterKey`);
        log(`[activation] state=trial remaining=${trial.daysRemaining}d`);
        refreshTree(machineId, license, trial);
        return { license, trial };
    }

    setBar('$(unverified) CPMForge', 'red', makeTooltip(
        '$(unverified) CPMForge — Trial Expired',
        ['Click to enter a license key.'],
    ), `${EXT_ID}.enterKey`);
    refreshTree(machineId, license, trial);
    void vscode.window.showErrorMessage(
        'CPMForge trial expired. Purchase a license to continue.',
        'Enter Key',
    ).then(sel => { if (sel === 'Enter Key') void vscode.commands.executeCommand(`${EXT_ID}.enterKey`); });
    log('[activation] state=expired');
    return { license, trial };
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdEnterKey(machineId: string): Promise<void> {
    const key = await vscode.window.showInputBox({
        prompt: 'Enter CPMForge license key',
        placeHolder: 'XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-V3',
        ignoreFocusOut: true,
        validateInput: v => (v?.trim() ? null : 'Key cannot be empty'),
    });
    if (!key) return;
    const trimmed = key.trim();
    saveLicenseKey(trimmed);
    log(`[key] saved key=${trimmed.slice(0, 6)}***`);
    await runLicenseCheck(machineId);
}

async function cmdDiagnostics(machineId: string): Promise<void> {
    const { license, trial } = await runLicenseCheck(machineId);
    const snap    = buildSnapshot(machineId, vscode.version, _host, collectCpmfExtensions(license), license, trial, _orchLicense, _orchUser);
    const report  = validateSnapshot(snap);
    const text    = [
        snapshotToText(snap),
        '',
        '=== Schema Validation ===',
        `Valid: ${report.valid}`,
        ...(report.errors.length ? report.errors.map(e => `  ERR: ${e}`) : ['  (no errors)']),
        '',
        '=== Schema Snapshot (JSON) ===',
        JSON.stringify(report.snapshot, null, 2),
    ].join('\n');
    void vscode.workspace.openTextDocument({ content: text, language: 'plaintext' })
        .then(doc => vscode.window.showTextDocument(doc, { preview: false }));
}

async function cmdLicenseStatus(
    machineId: string,
    onDeactivated: () => Promise<void>,
): Promise<void> {
    const { license, trial } = await runLicenseCheck(machineId);
    const fp  = fingerprintFromMachineId(machineId);
    const key = readLicenseKey();
    const lines = [
        `Machine ID:  ${machineId.slice(0, 8)}…`,
        `Fingerprint: ${fp}`,
        `License key: ${key ? key.slice(0, 6) + '***' : '(none)'}`,
    ];

    if (license?.valid) {
        const exp = license.expiry
            ? new Date(license.expiry).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
            : 'never';
        lines.push(
            `Status:      Licensed`,
            `Expires:     ${exp}`,
            `Machines:    ${license.machineCount ?? '?'} / ${license.maxMachines ?? '?'}`,
        );
    } else {
        lines.push(
            `Trial start: ${trial?.trialStart ?? 'n/a'}`,
            `Elapsed:     ${trial ? trial.daysElapsed + 'd' : 'n/a'}  Remaining: ${trial ? trial.daysRemaining + 'd' : 'n/a'}`,
            `Tampered:    ${trial?.tampered ?? false}${trial?.tamperedSources?.length ? ' (' + trial.tamperedSources.join(', ') + ')' : ''}`,
        );
    }

    const sel = await vscode.window.showInformationMessage(lines.join('\n'), 'OK', 'Deactivate Machine');
    log('[status] ' + lines.join(' | '));
    if (sel === 'Deactivate Machine') {
        if (!key) { void vscode.window.showErrorMessage('No license key saved.'); return; }
        const result = await deactivateMachine(key, fp, log);
        if (result.ok) {
            void vscode.window.showInformationMessage('Machine deactivated. Re-enter key to reactivate.', 'OK');
            log('[deactivate] done');
            await onDeactivated();
        } else {
            void vscode.window.showErrorMessage(`Deactivation failed: ${result.message}`, 'OK');
        }
    }
}

const ORCH_RETRY_DELAYS_MS = [3_000, 6_000, 12_000, 24_000]; // 4 retries, ~45s total

async function cmdOrchLicense(machineId: string, silent = false): Promise<void> {
    let lastError = '';
    for (let attempt = 0; attempt <= ORCH_RETRY_DELAYS_MS.length; attempt++) {
        try {
            if (attempt > 0) log(`[orch] retry ${attempt}/${ORCH_RETRY_DELAYS_MS.length}`);
            const { license: orchLic, user: orchUsr } = await getOrchestratorData(log);
            _orchLicense = orchLic;
            _orchUser    = orchUsr;
            await runLicenseCheck(machineId);
            if (!silent) {
                void vscode.window.showInformationMessage(
                    `Orchestrator: ${_orchLicense.SubscriptionPlan} | ${_orchUser.UserName} <${_orchUser.EmailAddress}>`,
                    'OK',
                );
            }
            return;
        } catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
            log(`[orch] attempt ${attempt + 1} failed: ${lastError}`);
            if (attempt < ORCH_RETRY_DELAYS_MS.length) {
                await new Promise(r => setTimeout(r, ORCH_RETRY_DELAYS_MS[attempt]));
            }
        }
    }
    if (!silent) {
        void vscode.window.showErrorMessage(`Orchestrator license fetch failed: ${lastError}`, 'OK');
    }
}

// ── Host detection ────────────────────────────────────────────────────────────

async function isUiPathStudio(): Promise<boolean> {
    try {
        await vscode.commands.executeCommand('uipath.interop.hasService', 'IStudioInteropService');
        return true;  // command exists in Studio (returns null but does not throw)
    } catch {
        return false; // command not found in VS Code
    }
}

// ── Activation ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
    _log  = vscode.window.createOutputChannel('CPMForge');
    _bar  = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    _tree = new RuntimeTreeProvider();
    context.subscriptions.push(
        _log,
        _bar,
        vscode.window.registerTreeDataProvider(`${EXT_ID}.runtimeView`, _tree),
    );

    const extVersion = vscode.extensions.getExtension(`cpmforge.${EXT_ID}`)?.packageJSON?.version as string ?? 'unknown';
    log(`activate  ext=${extVersion}  VSCode=${vscode.version}  platform=${process.platform}`);

    isUiPathStudio().then(studio => {
        _host = studio ? 'uips-desktop' : 'vscode';
        log(`[host] ${_host}`);
        if (studio) {
            cmdOrchLicense(machineId, true).catch(e => log(`[orch] auto-fetch error: ${e}`));
        }
    }).catch(() => log('[host] detection error'));

    const machineId = getMachineId(log);
    log(`[machine] id=${machineId.slice(0, 8)}…  fp=${fingerprintFromMachineId(machineId)}`);

    context.subscriptions.push(
        vscode.commands.registerCommand(`${EXT_ID}.enterKey`,      () => void cmdEnterKey(machineId)),
        vscode.commands.registerCommand(`${EXT_ID}.licenseStatus`, () => void cmdLicenseStatus(
            machineId,
            async () => {
                try { fs.unlinkSync(getLicenseKeyPath()); } catch { /* already gone */ }
                await runLicenseCheck(machineId);
            },
        )),
        vscode.commands.registerCommand(`${EXT_ID}.diagnostics`,   () => void cmdDiagnostics(machineId)),
        vscode.commands.registerCommand(`${EXT_ID}.refreshTree`,   () => void runLicenseCheck(machineId)),
        vscode.commands.registerCommand(`${EXT_ID}.orchConnect`,     () => void cmdOrchLicense(machineId)),
        vscode.commands.registerCommand(`${EXT_ID}.copyValue`, (item: vscode.TreeItem | string) => {
            // tooltip = "Label: fullValue"; description may be truncated
            const raw = typeof item === 'string' ? item : String(item.tooltip ?? item.description ?? '');
            const val = raw.includes(': ') ? raw.slice(raw.indexOf(': ') + 2) : raw;
            void vscode.env.clipboard.writeText(val).then(() =>
                vscode.window.showInformationMessage(`Copied: ${val}`, 'OK'),
            );
        }),
    );

    runLicenseCheck(machineId).catch(e => log(`[activation] unhandled error: ${e}`));
}

export function deactivate(): void {
    _bar?.dispose();
    _log?.dispose();
}
