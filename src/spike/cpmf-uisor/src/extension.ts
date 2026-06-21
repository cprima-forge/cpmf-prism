import * as vscode from 'vscode';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { discoverAll, Entry } from './discovery';
import { validateEntry, isValid } from './validator';

const EXT_ID = 'cpmf-uisor';
let _server: http.Server | null = null;
let _port = 0;
let _log: vscode.OutputChannel;

function log(msg: string) {
    _log.appendLine(`[${EXT_ID}] ${msg}`);
}

function getWorkspaceRoot(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath ?? null;
}

function getScreenshotsDir(): string | null {
    const ws = getWorkspaceRoot();
    return ws ? path.join(ws, '.screenshots') : null;
}

// ── SSE stream handler ────────────────────────────────────────────────────────

function handleStream(req: http.IncomingMessage, res: http.ServerResponse): void {
    const ws = getWorkspaceRoot();
    if (!ws) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No workspace open' }));
        return;
    }

    const objectsDir = path.join(ws, '.objects');
    if (!fs.existsSync(objectsDir)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `.objects not found at ${objectsDir}` }));
        return;
    }

    log(`[sse] client connected, ws=${ws}`);
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });

    const projectJsonPath = path.join(ws, 'project.json');
    let projectName = path.basename(ws);
    try {
        const pj = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8')) as { name?: string };
        projectName = pj.name ?? projectName;
    } catch { /* ignore */ }

    const t0 = Date.now();
    const ssDir = getScreenshotsDir();
    let count = 0;
    let aborted = false;

    function send(data: object) {
        if (!aborted) res.write('data: ' + JSON.stringify(data) + '\n\n');
    }

    send({ type: 'header', project: projectName, schema_version: 'v0.1.2' });

    // Stream entries as they are discovered
    try {
        discoverAll(objectsDir, (entry: Entry) => {
            if (aborted) return;

            // Embed screenshot if available
            const entryWithSS = { ...entry } as Entry & {
                screenshot_data?: string;
                screenshot_mime?: string;
            };
            if (entry.screenshot && ssDir) {
                const imgPath = path.join(ssDir, entry.screenshot);
                try {
                    const data = fs.readFileSync(imgPath);
                    entryWithSS.screenshot_data = data.toString('base64');
                    entryWithSS.screenshot_mime = entry.screenshot.toLowerCase().endsWith('.jpg')
                        ? 'image/jpeg' : 'image/png';
                    log(`[sse] screenshot FOUND ${entry.screenshot} (${data.length}b)`);
                } catch {
                    log(`[sse] screenshot MISSING ${imgPath}`);
                }
            }

            // T5: validate before sending
            const validated = validateEntry(entryWithSS);
            if (!isValid(validated)) {
                log(`[schema] INVALID ref=${entry.reference.slice(-12)} errors=${JSON.stringify(validated._validation_errors)}`);
            }
            send(validated);
            count++;
            log(`[sse] sent type=${entry.type} ref=${entry.reference.slice(-12)}${!isValid(validated) ? ' INVALID' : ''}`);
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`[sse] discovery error: ${msg}`);
        send({ type: 'error', message: msg });
    }

    const elapsed = Date.now() - t0;
    log(`[sse] done: ${count} entries in ${elapsed}ms`);
    send({ type: 'done', total: count, elapsed_ms: elapsed });
    res.end();

    req.on('close', () => {
        aborted = true;
        log('[sse] client disconnected');
    });
}

// ── HTTP server ───────────────────────────────────────────────────────────────

function buildAppHtml(themeClass: string, port: number): string {
    return `<!DOCTYPE html>
<html class="${themeClass}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src http://127.0.0.1:${port}; img-src data: http://127.0.0.1:${port};">
<title>UiPath OR Viewer</title>
<style>
:root{--bg:#fdf6e3;--bg2:#eee8d5;--body:#657b83;--faint:#93a1a1;--sol-blue:#268bd2;--sol-violet:#6c71c4;--green:#859900;--red:#dc322f}
.dark{--bg:#002b36;--bg2:#073642;--body:#839496;--faint:#586e75;--sol-blue:#268bd2;--sol-violet:#6c71c4;--green:#859900;--red:#dc322f}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--body);font-family:Consolas,Menlo,monospace;font-size:12px}
#toolbar{display:flex;gap:6px;align-items:center;padding:6px 8px;background:var(--bg2);border-bottom:1px solid var(--faint);position:sticky;top:0;z-index:10}
#proj-name{font-weight:bold;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#search{background:var(--bg);border:1px solid var(--faint);color:var(--body);padding:2px 6px;font-family:inherit;font-size:11px;flex:1;max-width:160px}
button{background:var(--bg2);border:1px solid var(--faint);color:var(--body);padding:2px 6px;cursor:pointer;font-size:11px}
button:hover{border-color:var(--sol-blue)}
#tree{padding:6px}
#detail{padding:8px;border-top:2px solid var(--sol-blue);background:var(--bg2)}
#detail.empty{display:none}
details summary{cursor:pointer;list-style:none;padding:2px 0}
details summary::-webkit-details-marker{display:none}
.node{display:block;width:100%;text-align:left;background:none;border:none;color:var(--body);padding:2px 4px;cursor:pointer;font-family:inherit;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.node:hover,.node.sel{background:var(--bg2);color:var(--sol-blue)}
.node.sel{border-left:2px solid var(--sol-blue)}
.app-h{font-weight:bold;color:var(--sol-violet);font-size:11px;padding:4px 0 2px}
.ver-h{color:var(--sol-violet);font-size:11px;padding:2px 0 2px 8px}
.scr-h{color:var(--sol-blue);padding:2px 0 1px 16px}
.el-row{padding-left:24px}
.cnt{color:var(--faint);font-size:10px}
.badge{font-size:9px;padding:0 3px;border-radius:2px;font-weight:bold}
.badge.screen{background:var(--sol-blue);color:#fff}
.badge.element{background:var(--sol-violet);color:#fff}
.card{border:1px solid var(--faint);border-radius:3px;padding:6px;margin-bottom:6px;background:var(--bg)}
.status-bar{position:fixed;bottom:0;left:0;right:0;background:var(--bg2);border-top:1px solid var(--faint);padding:2px 8px;font-size:10px;color:var(--faint)}
#stream-status{color:var(--green)}
</style>
</head>
<body>
<div id="toolbar">
  <span id="proj-name">Connecting…</span>
  <input id="search" type="text" placeholder="filter…">
  <button id="btn-reconnect" title="Reconnect">↺</button>
</div>
<div id="tree"></div>
<div id="detail" class="empty"></div>
<div class="status-bar"><span id="stream-status">⟳ streaming</span></div>
<script>
const API = 'http://127.0.0.1:${port}';
let uisor = null;
let selectedRef = null;

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Stream ────────────────────────────────────────────────────────────────────
let es = null;
const allEntries = [];
const t0 = performance.now();

function connectStream() {
    if (es) { es.close(); }
    allEntries.length = 0;
    uisor = null;
    document.getElementById('proj-name').textContent = 'Connecting…';
    document.getElementById('tree').innerHTML = '';
    document.getElementById('detail').className = 'empty';
    document.getElementById('stream-status').textContent = '⟳ streaming';

    es = new EventSource(API + '/api/stream');

    es.onmessage = e => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }

        if (msg.type === 'header') {
            document.getElementById('proj-name').textContent = msg.project + ' (0)';
            return;
        }
        if (msg.type === 'done') {
            es.close();
            document.getElementById('stream-status').textContent =
                '✓ ' + msg.total + ' entries in ' + msg.elapsed_ms + 'ms';
            console.log('[stream] done: ' + msg.total + ' entries in ' + msg.elapsed_ms + 'ms');
            return;
        }
        if (msg.type === 'error') {
            document.getElementById('stream-status').textContent = '✗ ' + msg.message;
            return;
        }

        // T5: log schema violations in browser console
        if (msg._validation_errors) {
            console.warn('[schema] INVALID ref=' + (msg.reference || '?').slice(-12) +
                ' errors=' + JSON.stringify(msg._validation_errors));
        }
        // screen or element entry
        allEntries.push(msg);
        uisor = { entries: allEntries };
        const elapsed = Math.round(performance.now() - t0);
        if (allEntries.length === 1) console.log('[stream] first entry at ' + elapsed + 'ms');
        const projEl = document.getElementById('proj-name');
        const base = projEl.textContent.replace(/ \\(\\d+\\)$/, '');
        projEl.textContent = base + ' (' + allEntries.length + ')';
        renderTree();
    };

    es.onerror = () => {
        document.getElementById('stream-status').textContent = '✗ stream error — click ↺ to retry';
    };
}

// ── Tree rendering ────────────────────────────────────────────────────────────

function buildHierarchy(entries) {
    const byRef = new Map();
    for (const e of entries) byRef.set(e.reference, { ...e, children: [] });
    const appMap = new Map();
    const verMap = new Map();
    for (const [, node] of byRef) {
        if (node.type === 'screen') {
            const parts = (node.path || '').split('/');
            const appName = parts[0] || node.app_name || '(unknown)';
            const verName = parts[1] || node.app_version || '';
            const verKey = appName + '/' + verName;
            if (!appMap.has(appName)) appMap.set(appName, { name: appName, versions: [] });
            if (!verMap.has(verKey)) {
                const ver = { name: verName, screens: [] };
                verMap.set(verKey, ver);
                appMap.get(appName).versions.push(ver);
            }
            verMap.get(verKey).screens.push(node);
        } else if (node.type === 'element') {
            const parent = byRef.get(node.parent_ref);
            if (parent) parent.children.push(node);
        }
    }
    return [...appMap.values()];
}

function nodeMatchesFilter(node, filteredRefs) {
    if (filteredRefs.has(node.reference)) return true;
    return (node.children || []).some(c => nodeMatchesFilter(c, filteredRefs));
}

function renderTree() {
    const q = document.getElementById('search').value.trim().toLowerCase();
    const entries = uisor?.entries || [];

    let filteredRefs = null;
    if (q) {
        const match = e =>
            (e.screen_name || '').toLowerCase().includes(q) ||
            (e.element_name || '').toLowerCase().includes(q) ||
            (e.url || '').toLowerCase().includes(q);
        filteredRefs = new Set(entries.filter(match).map(e => e.reference));
    }

    // T5: show invalid entries as red nodes at top
    const invalid = entries.filter(e => e._validation_errors && e._validation_errors.length);
    const apps = buildHierarchy(entries);
    let html = '';
    if (invalid.length) {
        html += '<div style="color:var(--red);padding:4px 6px;font-size:10px">⚠ ' + invalid.length + ' schema violation(s)</div>';
        for (const e of invalid) {
            const errs = (e._validation_errors || []).map(v => v.field + ': ' + v.message).join('; ');
            html += '<div style="color:var(--red);font-size:10px;padding:2px 6px">' + esc(errs) + '</div>';
        }
    }
    for (const app of apps) {
        html += '<div class="app-h">' + esc(app.name) + '</div>';
        for (const ver of app.versions) {
            html += '<div class="ver-h">' + esc(ver.name) + '</div>';
            for (const scr of ver.screens) {
                if (filteredRefs && !nodeMatchesFilter(scr, filteredRefs)) continue;
                const visKids = filteredRefs
                    ? scr.children.filter(c => nodeMatchesFilter(c, filteredRefs))
                    : scr.children;
                const open = !!q ? 'open' : '';
                html += '<details ' + open + '>';
                html += '<summary class="scr-h"><button class="node" data-ref="' + esc(scr.reference) + '">' +
                    '<span class="badge screen">SCR</span> ' + esc(scr.screen_name) + ' ' +
                    '<span class="cnt">' + scr.children.length + '</span></button></summary>';
                for (const el of visKids) {
                    html += renderElementRow(el, filteredRefs);
                }
                html += '</details>';
            }
        }
    }
    if (!html) html = '<div style="padding:8px;color:var(--faint)">' + (q ? 'No matches' : 'Waiting for entries…') + '</div>';
    document.getElementById('tree').innerHTML = html;

    document.querySelectorAll('.node').forEach(btn => {
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            selectRef(btn.dataset.ref);
        });
    });
}

function renderElementRow(el, filteredRefs, depth) {
    depth = depth || 0;
    const ml = depth > 0 ? 'margin-left:' + (depth * 10) + 'px' : '';
    let html = '<div class="el-row" style="' + ml + '">' +
        '<button class="node" data-ref="' + esc(el.reference) + '">' +
        '<span class="badge element">EL</span> ' + esc(el.element_name || '?') +
        (el.element_type ? ' <span class="cnt">' + esc(el.element_type) + '</span>' : '') +
        '</button></div>';
    const visKids = filteredRefs
        ? (el.children || []).filter(c => nodeMatchesFilter(c, filteredRefs))
        : (el.children || []);
    for (const c of visKids) html += renderElementRow(c, filteredRefs, depth + 1);
    return html;
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function selectRef(ref) {
    selectedRef = ref;
    const entries = uisor?.entries || [];
    const entry = entries.find(e => e.reference === ref);
    document.querySelectorAll('.node').forEach(b =>
        b.classList.toggle('sel', b.dataset.ref === ref));
    renderDetail(entry, entries);
}

function entryCard(entry, isChild) {
    if (!entry) return '';
    const isScreen = entry.type === 'screen';
    const badge = isScreen
        ? '<span class="badge screen">SCREEN</span>'
        : '<span class="badge element">ELEMENT</span>';
    const title = isScreen ? entry.screen_name : entry.element_name;
    const ss = entry.screenshot_data
        ? '<img src="data:' + (entry.screenshot_mime || 'image/png') + ';base64,' + entry.screenshot_data +
          '" style="max-width:100%;display:block;border:1px solid var(--faint);margin-top:4px">'
        : '';
    let fields = '';
    if (isScreen) {
        if (entry.url) fields += '<div>' + esc(entry.url) + '</div>';
        if (entry.selector) fields += '<div class="cnt">' + esc(entry.selector) + '</div>';
    } else {
        if (entry.element_type) fields += '<div class="cnt">' + esc(entry.element_type) + '</div>';
        if (entry.full_selector) fields += '<div class="cnt">' + esc(entry.full_selector) + '</div>';
    }
    return '<div class="card">' + badge + ' <strong>' + esc(title) + '</strong>' + fields + ss + '</div>';
}

function renderChildrenRecursive(parentRef, allEntries, depth) {
    const kids = allEntries.filter(e => e.parent_ref === parentRef);
    if (!kids.length) return '';
    return kids.map(c => {
        const ml = depth > 0 ? 'margin-left:' + (depth * 10) + 'px;' : '';
        return '<div class="card" style="' + ml + 'margin-bottom:4px">' +
            '<span class="badge element">ELEMENT</span> <strong>' + esc(c.element_name || '?') + '</strong>' +
            (c.element_type ? ' <span class="cnt">' + esc(c.element_type) + '</span>' : '') +
            (c.screenshot_data ? '<img src="data:' + (c.screenshot_mime || 'image/png') + ';base64,' + c.screenshot_data +
                '" style="max-width:100%;display:block;border:1px solid var(--faint);margin-top:4px">' : '') +
            '</div>' + renderChildrenRecursive(c.reference, allEntries, depth + 1);
    }).join('');
}

function renderDetail(entry, allEntries) {
    const el = document.getElementById('detail');
    if (!entry) { el.className = 'empty'; el.innerHTML = ''; return; }
    el.className = '';
    const hasKids = allEntries.some(e => e.parent_ref === entry.reference);
    el.innerHTML = entryCard(entry, false) +
        (hasKids ? renderChildrenRecursive(entry.reference, allEntries, 0) : '');
}

// ── Events ────────────────────────────────────────────────────────────────────

document.getElementById('search').addEventListener('input', () => renderTree());
document.getElementById('btn-reconnect').addEventListener('click', () => connectStream());

connectStream();
</script>
</body>
</html>`;
}

// ── WebView provider ──────────────────────────────────────────────────────────

class InventoryViewProvider implements vscode.WebviewViewProvider {
    constructor(private readonly _extensionUri: vscode.Uri, private readonly port: number) {}

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        webviewView.webview.options = { enableScripts: true };
        const themeClass = (vscode.window.activeColorTheme?.kind ?? 2) === 1 ? 'light' : 'dark';
        webviewView.webview.html = buildAppHtml(themeClass, this.port);
    }
}

// ── Activation ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
    _log = vscode.window.createOutputChannel('UiPath OR Viewer');
    log('activate');

    _server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (req.method === 'GET') {
            const url = req.url ?? '/';

            if (url === '/' || url.startsWith('/?')) {
                const themeClass = (vscode.window.activeColorTheme?.kind ?? 2) === 1 ? 'light' : 'dark';
                res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
                res.end(buildAppHtml(themeClass, _port));
                return;
            }

            if (url.startsWith('/api/stream')) {
                handleStream(req, res);
                return;
            }

            res.writeHead(404);
            res.end();
        }
    });

    _server.listen(0, '127.0.0.1', () => {
        const addr = _server!.address();
        _port = typeof addr === 'object' && addr ? addr.port : 0;
        log(`HTTP server on port ${_port}`);

        const provider = new InventoryViewProvider(context.extensionUri, _port);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('cpmf-uisor.sideView', provider)
        );
    });

    context.subscriptions.push(
        vscode.commands.registerCommand(`${EXT_ID}.refresh`, () => {
            log('refresh command');
            // SSE client handles reconnect via its own ↺ button
        })
    );
}

export function deactivate(): void {
    _server?.close();
    _log?.dispose();
}
