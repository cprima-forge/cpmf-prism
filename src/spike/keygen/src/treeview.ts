// Sidebar TreeView — live runtime snapshot as a structured tree.
// Refresh manually via command or call refresh() after any state change.

import * as vscode from 'vscode';
import { RuntimeSnapshot } from './diagnostics';
import { SchemaReport } from './schema-validator';

type NodeKind = 'section' | 'ok' | 'warn' | 'error' | 'info';

interface TreeNode {
    label: string;
    value?: string;
    fullValue?: string;
    kind: NodeKind;
    children?: TreeNode[];
    collapsible?: boolean;
    contextValue?: string;
    command?: { command: string; title: string; arguments?: unknown[] };
}

function icon(kind: NodeKind): vscode.ThemeIcon {
    switch (kind) {
        case 'ok':    return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        case 'warn':  return new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
        case 'error': return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
        case 'section': return new vscode.ThemeIcon('folder');
        default:      return new vscode.ThemeIcon('circle-outline');
    }
}

function row(label: string, value: string | undefined, kind: NodeKind = 'info'): TreeNode {
    return { label, value, kind };
}

function section(label: string, children: TreeNode[]): TreeNode {
    return { label, kind: 'section', children, collapsible: true };
}

function buildTree(s: RuntimeSnapshot | null, report: SchemaReport | null): TreeNode[] {
    if (!s) {
        return [row('No snapshot yet — extension initialising', undefined, 'warn')];
    }

    const machineConsistent =
        (!s.machine.idFromRegistry     || s.machine.idFromRegistry     === s.machine.id) &&
        (!s.machine.idFromProgramData  || s.machine.idFromProgramData  === s.machine.id) &&
        (!s.machine.idFromLocalAppData || s.machine.idFromLocalAppData === s.machine.id);

    const orchNode: TreeNode = section('License (Orchestrator)', s.orchLicense ? [
        row('Plan',           s.orchLicense.SubscriptionPlan,                                                   'info'),
        row('Code',           s.orchLicense.SubscriptionCode,                                                   'info'),
        row('Community',      String(s.orchLicense.IsCommunity),       s.orchLicense.IsCommunity      ? 'warn' : 'ok'),
        row('Pro/Enterprise', String(s.orchLicense.IsProOrEnterprise),  s.orchLicense.IsProOrEnterprise ? 'ok'  : 'warn'),
    ] : [row('Not fetched', undefined, 'warn')]);

    const orchUserNode: TreeNode = section('Current User (Orchestrator)', s.orchUser ? [
        {
            label: 'Key', value: s.orchUser.Key.slice(0, 8) + '…',
            fullValue: s.orchUser.Key, kind: (s.orchUser.Key ? 'ok' : 'error') as NodeKind, contextValue: 'copyable',
        },
        row('DirectoryId',  s.orchUser.DirectoryIdentifier ?? '(none)',        s.orchUser.DirectoryIdentifier ? 'info' : 'warn'),
        s.orchUser.TenantKey
            ? { label: 'TenantKey', value: s.orchUser.TenantKey.slice(0, 8) + '…', fullValue: s.orchUser.TenantKey, kind: 'info' as NodeKind, contextValue: 'copyable' }
            : row('TenantKey', '(none)', 'warn'),
        row('UserName',     s.orchUser.UserName,                               'info'),
        row('Name',         `${s.orchUser.Name} ${s.orchUser.Surname}`.trim(), 'info'),
        row('Email',        s.orchUser.EmailAddress,                           'info'),
        row('Active',       String(s.orchUser.IsActive), s.orchUser.IsActive ? 'ok' : 'warn'),
        row('Id (db)',      String(s.orchUser.Id),                             'info'),
    ] : [row('Not fetched', undefined, 'warn')]);

    return [
        section('Runtime', [
            row('Host',      s.host ?? 'unknown',                      s.host === 'uips-desktop' ? 'ok' : 'info'),
            row('Timestamp', s.timestamp),
            row('Platform',  `${s.platform} · ${s.hostname}`),
            row('Node',      s.nodeVersion),
            row('VSCode',    s.vscodeVersion),
        ]),

        section('CPMForge Extensions', s.extensions.length
            ? s.extensions.map(e => section(e.id, [
                row('version',          `v${e.version}`,                                              'info'),
                row('license.valid',    e.keygen_license ? String(e.keygen_license.valid) : 'n/a',   e.keygen_license?.valid ? 'ok' : 'warn'),
                row('license.expires_at', e.keygen_license?.expires_at ?? 'n/a'),
              ]))
            : [row('None found', undefined, 'warn')]
        ),

        section('Machine Identity', [
            {
                label: 'ID',
                value: s.machine.id.slice(0, 8) + '…',
                fullValue: s.machine.id,
                kind: machineConsistent ? 'ok' : 'warn' as NodeKind,
                contextValue: 'copyable',
            },
            row('Registry',     s.machine.idFromRegistry     ?? '(missing)', s.machine.idFromRegistry     ? 'ok' : 'warn'),
            row('ProgramData',  s.machine.idFromProgramData  ?? '(missing)', s.machine.idFromProgramData  ? 'ok' : 'warn'),
            row('LocalAppData', s.machine.idFromLocalAppData ?? '(missing)', s.machine.idFromLocalAppData ? 'ok' : 'warn'),
        ]),

        section('Registry', [
            row('HKLM reachable', String(s.registry.hklmReachable), s.registry.hklmReachable ? 'ok' : 'warn'),
            row('MachineId',      s.registry.machineId ?? '(missing)',   s.registry.machineId ? 'ok' : 'warn'),
        ]),

        orchNode,
        orchUserNode,

        section('Schema Validation', report
            ? [
                row('Valid',   String(report.valid), report.valid ? 'ok' : 'error'),
                row('Version', 'v0.1.0', 'info'),
                ...(report.errors.map(e => row(e, undefined, 'error'))),
              ]
            : [row('Not validated', undefined, 'warn')]
        ),
    ];
}

// ── TreeDataProvider ──────────────────────────────────────────────────────────

export class RuntimeTreeItem extends vscode.TreeItem {
    constructor(private readonly node: TreeNode) {
        super(
            node.label,
            node.children?.length
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None,
        );
        if (node.value !== undefined) {
            this.description = node.value;
        }
        this.iconPath     = icon(node.kind);
        const full        = node.fullValue ?? node.value;
        this.tooltip      = full ? `${node.label}: ${full}` : node.label;
        if (node.contextValue) this.contextValue = node.contextValue;
        if (node.command)      this.command      = node.command;
    }

    getChildren(): TreeNode[] {
        return this.node.children ?? [];
    }
}

export class RuntimeTreeProvider implements vscode.TreeDataProvider<RuntimeTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<RuntimeTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _snapshot: RuntimeSnapshot | null = null;
    private _report:   SchemaReport    | null = null;

    update(snapshot: RuntimeSnapshot, report: SchemaReport): void {
        this._snapshot = snapshot;
        this._report   = report;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(item: RuntimeTreeItem): vscode.TreeItem {
        return item;
    }

    getChildren(parent?: RuntimeTreeItem): RuntimeTreeItem[] {
        const nodes = parent ? parent.getChildren() : buildTree(this._snapshot, this._report);
        return nodes.map(n => new RuntimeTreeItem(n));
    }
}
