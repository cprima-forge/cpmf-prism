// Runtime environment snapshot — all observable state in one place.
// Consumed by the TreeView provider and the dump command.

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { programDataDir, localAppDataDir, readJson, readText } from './storage';
import { readRegistry } from './registry';
import { fingerprintFromMachineId } from './machine';
import { TrialStatus } from './trial';
import { ValidationResult } from './license';
import { OrchestratorLicense, OrchestratorUser } from './orchestrator';

export type HostType = 'uips-desktop' | 'vscode' | null;

export interface CpmfExtension {
    id: string;
    version: string;
    keygen_license: {
        valid: boolean;
        expires_at: string | null;
        entitlements: unknown[];
    } | null;
}

export interface RuntimeSnapshot {
    timestamp: string;
    host: HostType;
    extensions: CpmfExtension[];
    platform: string;
    hostname: string;
    nodeVersion: string;
    vscodeVersion: string;

    machine: {
        id: string;
        fingerprint: string;
        idFromRegistry: string | null;
        idFromProgramData: string | null;
        idFromLocalAppData: string | null;
    };

    paths: {
        programData: string;
        localAppData: string;
        licenseKey: string;
        activationJson: string;
        cacheJson: string;
        logsDir: string;
    };

    files: {
        activationJsonExists: boolean;
        cacheJsonExists: boolean;
        licenseKeyExists: boolean;
        logFiles: string[];
    };

    registry: {
        machineId: string | null;
        trialStart: string | null;
        hklmReachable: boolean;
    };

    license: ValidationResult | null;
    trial: TrialStatus | null;
    orchLicense: OrchestratorLicense | null;
    orchUser: OrchestratorUser | null;
}

function fileExists(p: string): boolean {
    try { fs.accessSync(p); return true; } catch { return false; }
}

function listLogFiles(logsDir: string): string[] {
    try { return fs.readdirSync(logsDir).filter(f => f.endsWith('.log')); }
    catch { return []; }
}

export function buildSnapshot(
    machineId: string,
    vscodeVersion: string,
    host: HostType,
    extensions: CpmfExtension[],
    license: ValidationResult | null,
    trial: TrialStatus | null,
    orchLicense: OrchestratorLicense | null = null,
    orchUser: OrchestratorUser | null = null,
): RuntimeSnapshot {
    const pdDir  = programDataDir();
    const ladDir = localAppDataDir();

    const activationJson = path.join(pdDir,  'activation.json');
    const cacheJson      = path.join(ladDir, 'cache.json');
    const licenseKeyPath = path.join(ladDir, 'license.key');
    const logsDir        = path.join(ladDir, 'logs');

    let hklmReachable = false;
    try {
        const { execSync } = require('child_process') as typeof import('child_process');
        execSync('reg query "HKLM\\Software\\Microsoft\\Windows NT\\CurrentVersion" /v "ProductName"', {
            stdio: ['pipe', 'pipe', 'pipe'], timeout: 2000,
        });
        hklmReachable = true;
    } catch { /* blocked or non-Windows */ }

    return {
        timestamp: new Date().toISOString(),
        host,
        extensions,
        platform:     process.platform,
        hostname:     os.hostname(),
        nodeVersion:  process.version,
        vscodeVersion,

        machine: {
            id:                 machineId,
            fingerprint:        fingerprintFromMachineId(machineId),
            idFromRegistry:     readRegistry('MachineId'),
            idFromProgramData:  readText(path.join(pdDir, 'machine.id')),
            idFromLocalAppData: readText(path.join(ladDir, 'machine.id')),
        },

        paths: {
            programData:  pdDir,
            localAppData: ladDir,
            licenseKey:   licenseKeyPath,
            activationJson,
            cacheJson,
            logsDir,
        },

        files: {
            activationJsonExists: fileExists(activationJson),
            cacheJsonExists:      fileExists(cacheJson),
            licenseKeyExists:     fileExists(licenseKeyPath),
            logFiles:             listLogFiles(logsDir),
        },

        registry: {
            machineId:     readRegistry('MachineId'),
            trialStart:    readRegistry('TrialStart'),
            hklmReachable,
        },

        license,
        trial,
        orchLicense,
        orchUser,
    };
}

export function snapshotToText(s: RuntimeSnapshot): string {
    const lines: string[] = [
        '=== CPMForge Runtime Environment ===',
        `Timestamp    : ${s.timestamp}`,
        `Host         : ${s.host ?? 'unknown'}`,
        `Platform     : ${s.platform}  hostname=${s.hostname}`,
        `Node         : ${s.nodeVersion}  VSCode=${s.vscodeVersion}`,
        ...s.extensions.map(e => `Extension    : ${e.id}  v${e.version}  licensed=${e.keygen_license?.valid ?? 'n/a'}`),
        `Host         : ${s.host ?? 'unknown'}`,
        '',
        '--- Machine Identity ---',
        `ID           : ${s.machine.id}`,
        `Fingerprint  : ${s.machine.fingerprint}`,
        `Registry     : ${s.machine.idFromRegistry ?? '(missing)'}`,
        `ProgramData  : ${s.machine.idFromProgramData ?? '(missing)'}`,
        `LocalAppData : ${s.machine.idFromLocalAppData ?? '(missing)'}`,
        '',
        '--- Storage Paths ---',
        `ProgramData  : ${s.paths.programData}`,
        `LocalAppData : ${s.paths.localAppData}`,
        `LicenseKey   : ${s.paths.licenseKey}`,
        `Activation   : ${s.paths.activationJson}`,
        `Cache        : ${s.paths.cacheJson}`,
        `Logs         : ${s.paths.logsDir}`,
        '',
        '--- File State ---',
        `activation.json : ${s.files.activationJsonExists ? 'EXISTS' : 'MISSING'}`,
        `cache.json      : ${s.files.cacheJsonExists      ? 'EXISTS' : 'MISSING'}`,
        `license.key     : ${s.files.licenseKeyExists     ? 'EXISTS' : 'MISSING'}`,
        `log files       : ${s.files.logFiles.join(', ') || '(none)'}`,
        '',
        '--- Registry ---',
        `HKLM reachable  : ${s.registry.hklmReachable}`,
        `MachineId       : ${s.registry.machineId ?? '(missing)'}`,
        `TrialStart      : ${s.registry.trialStart ?? '(missing)'}`,
        '',
        '--- License ---',
        s.license
            ? `valid=${s.license.valid}  code=${s.license.code}  expiry=${s.license.expiry ?? 'n/a'}  machines=${s.license.machineCount ?? '?'}/${s.license.maxMachines ?? '?'}  msg=${s.license.message}`
            : '(not validated)',
        '',
        '--- Trial ---',
        s.trial
            ? `active=${s.trial.active}  start=${s.trial.trialStart ?? 'n/a'}  elapsed=${s.trial.daysElapsed}d  remaining=${s.trial.daysRemaining}d  tampered=${s.trial.tampered}` +
              (s.trial.tamperedSources.length ? `\ntampered sources: ${s.trial.tamperedSources.join(', ')}` : '')
            : '(not checked)',
        '',
        '--- Orchestrator License ---',
        s.orchLicense
            ? `plan=${s.orchLicense.SubscriptionPlan}  code=${s.orchLicense.SubscriptionCode}  community=${s.orchLicense.IsCommunity}  proOrEnterprise=${s.orchLicense.IsProOrEnterprise}  registered=${s.orchLicense.IsRegistered}  expired=${s.orchLicense.IsExpired}`
            : '(not fetched — use orchConnect)',
        '',
        '=====================================',
    ];
    return lines.join('\n');
}
