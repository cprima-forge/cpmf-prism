'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const https = require('https');

const vscode    = require('vscode');
const LOG_FILE  = path.join(os.tmpdir(), 'cpmf-uipath-spike.log');
const DUMP_FILE = path.join(os.tmpdir(), 'cpmf-uipath-spike-dump.json');
const OIDC_DIR  = path.join(os.homedir(), 'AppData', 'Roaming', 'UiPath', 'Oidc');

function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── logging ──────────────────────────────────────────────────────────────────

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function write(label, value) {
    log(`${label}: ${JSON.stringify(value, null, 2)}`);
}

async function tryCall(label, fn) {
    try {
        const result = await fn();
        write(label, result);
        return result;
    } catch (e) {
        log(`${label} ERROR: ${e?.message || String(e)}`);
        return undefined;
    }
}

// ── OIDC helpers ─────────────────────────────────────────────────────────────

function readOidcSessions() {
    try {
        const p = path.join(OIDC_DIR, 'reusableSessions.json');
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch { return []; }
}

function getOrchestratorInfo() {
    const sessions = readOidcSessions();
    if (!sessions.length) return null;
    const s = sessions[0];
    const authorityUrl = s?.Key?.AuthorityUrl || '';
    const orgId = s?.Key?.OrgId || '';
    // Strip /identity_ suffix to get cloud base
    const cloudBase = authorityUrl.replace(/\/identity_?\/?$/, '').replace(/\/$/, '');
    return { cloudBase, orgId, refreshToken: s?.RefreshToken };
}

// ── license fetch ─────────────────────────────────────────────────────────────

async function getLicense(token, orchestratorBase) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${orchestratorBase}/odata/Settings/UiPath.Server.Configuration.OData.GetLicense`);
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        };
        const req = https.request(options, res => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
                catch { resolve({ status: res.statusCode, body }); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function dumpLicense() {
    log('=== LICENSE ===');

    // Use `uip login refresh` — guaranteed fresh token, no client_id guessing needed
    let uipData;
    try {
        const { execSync } = require('child_process');
        const raw = execSync('uip login refresh --output json', { timeout: 10000, encoding: 'utf-8' });
        uipData = JSON.parse(raw).Data;
    } catch (e) {
        log(`LICENSE: uip login refresh failed — ${e?.message}`);
        return { license: null, error: String(e?.message) };
    }

    const token   = uipData.AccessToken;
    const orgId   = uipData.OrganizationId;
    const tenant  = uipData.TenantName;
    const baseUrl = uipData.BaseUrl;
    const orchestratorBase = `${baseUrl}/${orgId}/${tenant}`;
    log(`LICENSE: org=${uipData.OrganizationName} tenant=${tenant} expires=${uipData.ExpirationDate}`);

    const licenseResult = await tryCall('getLicense', () => getLicense(token, orchestratorBase));
    return { org: uipData.OrganizationName, tenant, license: licenseResult };
}

async function dumpLicenseKeygen() {
    log('=== LICENSE (keygen.sh) ===');
    // Read key from %LOCALAPPDATA%\cpmf-uisor\license.key
    let licenseKey = null;
    const licensePath = require('path').join(os.homedir(), 'AppData', 'Local', 'cpmf-uisor', 'license.key');
    log(`[license] reading key from ${licensePath}`);
    try {
        licenseKey = fs.readFileSync(licensePath, 'utf8').trim();
        log(`[license] key present: ${licenseKey.slice(0, 6)}***`);
    } catch (e) {
        log(`[license] key file not found (${e.code}) — using fallback`);
        // Fallback to hardcoded test key for dev
        licenseKey = 'EC43C5-CF2786-5BDBCF-470CBA-1146DE-V3';
        log(`[license] fallback key: ${licenseKey.slice(0, 6)}***`);
    }
    return new Promise((resolve) => {
        const payload = JSON.stringify({
            meta: {
                key: licenseKey,
                scope: {
                    product: '19c1f481-a383-4e9d-8714-40459788102b',
                    policy: '27eef182-8d80-4daf-b3b2-4b58803289d4',
                    fingerprint: '89:74:36:40:13:77:72:00',
                },
            },
        });
        const opts = {
            hostname: 'api.keygen.sh',
            path: '/v1/accounts/cprima/licenses/actions/validate-key',
            method: 'POST',
            headers: {
                'Content-Type': 'application/vnd.api+json',
                'Accept': 'application/vnd.api+json',
                'Content-Length': Buffer.byteLength(payload),
            },
        };
        log(`[license] POST https://api.keygen.sh${opts.path}`);
        const req = https.request(opts, res => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => {
                log(`[license] HTTP ${res.statusCode} (${raw.length}b)`);
                try {
                    const parsed = JSON.parse(raw);
                    const valid = parsed?.meta?.valid;
                    const code  = parsed?.meta?.code;
                    const detail = parsed?.meta?.detail || '';
                    log(`[license] valid=${valid} code=${code} detail=${detail}`);
                    resolve({ valid, code, detail, status: res.statusCode, body: parsed });
                } catch (e) {
                    log(`[license] JSON parse error: ${e.message} raw=${raw.slice(0, 120)}`);
                    resolve({ valid: null, error: e.message, raw });
                }
            });
        });
        req.on('error', e => {
            log(`[license] request error: ${e.message}`);
            resolve({ valid: null, error: e.message });
        });
        req.setTimeout(10000, () => {
            log('[license] request timeout (10s)');
            req.destroy();
            resolve({ valid: null, error: 'timeout' });
        });
        req.write(payload);
        req.end();
    });
}

// ── sections ─────────────────────────────────────────────────────────────────

async function dumpCommands() {
    log('=== COMMANDS ===');
    const all = await tryCall('getCommands(all)', () => vscode.commands.getCommands(false));
    if (Array.isArray(all)) {
        const uipath = all.filter(c => /uipath|studio|autopilot|interop|rpa/i.test(c));
        write('uipath-related commands', uipath);
        write('total command count', all.length);
    }
    return all;
}

async function dumpInterop() {
    log('=== INTEROP (describeServices probes) ===');
    const probes = [
        [],
        [{}],
        ['IStudioInteropService'],
        ['IAuthenticationService'],
        ['IPackageService'],
        [{ service: 'IAuthenticationService', method: 'getAccessToken' }],
        [{ name: 'IAuthenticationService' }],
        [null],
    ];
    for (const args of probes) {
        await tryCall(
            `describeServices(${JSON.stringify(args)})`,
            () => vscode.commands.executeCommand('uipath.codedWorkflows.describeServices', ...args)
        );
    }
}

async function dumpProject() {
    log('=== PROJECT ===');
    const folders = vscode.workspace.workspaceFolders;
    const result = { workspaceFolders: null, projectJson: null, files: [] };

    result.workspaceFolders = folders ? folders.map(f => ({ name: f.name, uri: f.uri.toString() })) : null;
    write('workspaceFolders', result.workspaceFolders);

    if (!folders?.length) return result;

    const root = folders[0].uri.fsPath;
    try {
        result.projectJson = JSON.parse(fs.readFileSync(path.join(root, 'project.json'), 'utf-8'));
        write('project.json.name', result.projectJson.name);
        write('project.json.dependencies', result.projectJson.dependencies);
    } catch (e) { log(`project.json error: ${e?.message}`); }

    try {
        const uris = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 500);
        result.files = uris.map(u => vscode.workspace.asRelativePath(u)).sort();
        log(`Files: ${result.files.length}`);
    } catch (e) { log(`findFiles error: ${e?.message}`); }

    return result;
}

async function dumpEnv() {
    log('=== ENVIRONMENT ===');
    return {
        version:    vscode.version,
        appName:    vscode.env.appName,
        machineId:  vscode.env.machineId,
        sessionId:  vscode.env.sessionId,
        uiKind:     vscode.env.uiKind,
        cwd:        process.cwd(),
        node:       process.versions.node,
        ipcPipe:    process.env.VSCODE_IPC_HOOK_EXTHOST,
    };
}

async function dumpInventory() {
    log('=== INVENTORY (SSE stream — see sidebar) ===');
    // ZIP-based inventory removed. Use the SSE stream in the sidebar webview.
    return { uisor: null, selectedRef: null, searchQuery: '', _note: 'use SSE /api/stream in sidebar' };
}

// ── shared CSS ────────────────────────────────────────────────────────────────

function sharedCss() {
    return `
  :root {
    --sol-yellow:#b58900; --sol-orange:#cb4b16; --sol-red:#dc322f;
    --sol-magenta:#d33682; --sol-violet:#6c71c4; --sol-blue:#268bd2;
    --sol-cyan:#2aa198; --sol-green:#859900;
  }
  body.dark  { --bg:#002b36; --bg2:#073642; --faint:#586e75; --muted:#657b83; --body:#839496; --emph:#93a1a1; --stripe:#01222b; }
  body.light { --bg:#fdf6e3; --bg2:#eee8d5; --faint:#93a1a1; --muted:#839496; --body:#657b83; --emph:#586e75; --stripe:#f5efdc; }
  * { box-sizing: border-box; }
  html, body { background-color: var(--bg) !important; color: var(--body) !important; }
  body   { font-family: 'Consolas','Menlo',monospace; font-size: 12px; padding: 12px; margin: 0; }
  h1     { font-size: 14px; color: var(--emph); font-weight: bold; border-bottom: 1px solid var(--bg2); padding-bottom: 6px; margin: 0 0 12px; }
  h2     { font-size: 11px; color: var(--sol-cyan); text-transform: uppercase; letter-spacing: .08em; margin: 16px 0 6px; }
  table  { border-collapse: collapse; width: 100%; font-size: 11px; }
  th     { background: var(--bg2); color: var(--emph); padding: 4px 8px; text-align: left; border: 1px solid var(--faint); }
  td     { padding: 3px 8px; border: 1px solid var(--bg2); color: var(--body); }
  tr:nth-child(even) td { background: var(--stripe); }
  td:first-child { color: var(--muted); }
  td:last-child  { color: var(--emph); }
  a      { color: var(--sol-blue); text-decoration: none; }
  pre    { background: var(--bg2); color: var(--sol-green); padding: 8px; overflow: auto; font-size: 11px; white-space: pre-wrap; border-left: 3px solid var(--sol-cyan); }
  ul     { margin: 4px 0; padding-left: 18px; }
  li     { color: var(--body); margin: 1px 0; font-size: 11px; }
  .grid  { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .card  { background: var(--bg2); padding: 10px; border-radius: 4px; border: 1px solid var(--faint); }
  .ok    { color: var(--sol-green); }
  .warn  { color: var(--sol-yellow); }
  .err   { color: var(--sol-red); }
  .muted { color: var(--muted); }
  .label { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
  .value { color: var(--emph); font-weight: bold; }`;
}

// ── inventory ─────────────────────────────────────────────────────────────────

function getScreenshotsDir() {
    const vscode = require('vscode');
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    return ws ? require('path').join(ws, '.screenshots') : null;
}

function buildInventorySideHtml(inv, port, themeClass) {
    return buildInventoryAppHtml(themeClass, port);
}

function buildInventoryAppHtml(themeClass, port) {
    return `<!DOCTYPE html><html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src http://127.0.0.1:${port}; img-src data: http://127.0.0.1:${port};">
<title>Inventory</title>
<style>
:root{--sol-yellow:#b58900;--sol-orange:#cb4b16;--sol-red:#dc322f;--sol-magenta:#d33682;--sol-violet:#6c71c4;--sol-blue:#268bd2;--sol-cyan:#2aa198;--sol-green:#859900;}
body.dark{--bg:#002b36;--bg2:#073642;--faint:#586e75;--muted:#657b83;--body:#839496;--emph:#93a1a1;}
body.light{--bg:#fdf6e3;--bg2:#eee8d5;--faint:#93a1a1;--muted:#839496;--body:#657b83;--emph:#586e75;}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--body);font-family:Consolas,Menlo,monospace;font-size:12px}
#toolbar{display:flex;gap:6px;align-items:center;padding:6px 8px;background:var(--bg2);border-bottom:1px solid var(--faint);position:sticky;top:0;z-index:10}
#toolbar strong{color:var(--emph);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
#search{width:0;flex:2;background:var(--bg);color:var(--emph);border:1px solid var(--faint);padding:3px 6px;font-size:11px;font-family:inherit;min-width:0}
#refresh-btn{background:var(--sol-blue);color:var(--bg);border:none;padding:3px 8px;cursor:pointer;font-size:11px;flex-shrink:0}
#tree{padding:6px}
#detail{padding:8px;border-top:2px solid var(--sol-blue);background:var(--bg2)}
#detail.empty{display:none}
details>summary{cursor:pointer;padding:2px 0;list-style:none;user-select:none;display:flex;align-items:baseline;gap:2px}
details>summary::before{content:'▶';font-size:9px;color:var(--muted);flex-shrink:0;width:10px}
details[open]>summary::before{content:'▼'}
details>summary::-webkit-details-marker{display:none}
.node{background:none;border:none;color:var(--emph);cursor:pointer;font-size:11px;font-family:inherit;padding:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.node:hover{color:var(--sol-blue)}
.node.sel{color:var(--sol-yellow);font-weight:bold}
.sc{color:var(--sol-cyan);font-size:9px;flex-shrink:0}
.el{color:var(--sol-green);font-size:9px;flex-shrink:0}
.ver{color:var(--sol-violet);font-size:11px}
.ver-t{color:var(--sol-violet)}
.bv{background:var(--sol-yellow);color:var(--bg);border-radius:2px;padding:0 2px;font-size:8px;flex-shrink:0}
.si{background:var(--sol-blue);color:var(--bg);border-radius:2px;padding:0 2px;font-size:8px;flex-shrink:0}
.ch{margin-left:12px;border-left:1px solid var(--faint);padding-left:5px}
.cnt{color:var(--muted);font-size:9px;flex-shrink:0}
.leaf{padding:2px 0;display:flex;align-items:baseline;gap:2px}
.err{color:var(--sol-red);padding:8px}
.loading{color:var(--muted);padding:8px;font-size:11px}
#detail h3{color:var(--emph);font-size:11px;margin-bottom:6px}
.dl{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:10px}
.dk{color:var(--muted);text-transform:uppercase;font-size:9px;padding-top:1px;white-space:nowrap}
.dv{color:var(--emph);word-break:break-all}
.sel-badge{font-size:9px;padding:1px 4px;border-radius:2px;margin-bottom:4px;display:inline-block}
.sel-badge.screen{background:var(--sol-cyan);color:var(--bg)}
.sel-badge.element{background:var(--sol-green);color:var(--bg)}
pre.sel-code{background:var(--bg);color:var(--sol-green);padding:5px;font-size:9px;overflow:auto;white-space:pre-wrap;border-left:2px solid var(--sol-cyan);margin-top:4px;max-height:100px}
.ss-wrap{margin-bottom:6px}.ss-dim{color:var(--muted);font-size:9px;margin-top:2px}
.card{border:1px solid var(--faint);border-radius:3px;padding:6px;margin-bottom:6px;background:var(--bg)}
</style>
</head>
<body class="${themeClass}">
<div id="toolbar">
  <strong id="proj-name">Inventory</strong>
  <input id="search" type="search" placeholder="Search…">
  <button id="refresh-btn" title="Reconnect stream">↺</button>
  <button id="export-btn" title="Export Markdown to Documentation/CPMForge/">MD</button>
</div>
<div id="tree"><div class="loading">Loading…</div></div>
<div id="detail" class="empty"></div>
<script>
const PORT = ${port};
const API  = 'http://127.0.0.1:' + PORT;
let uisor = null;
let selectedRef = null;

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

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

function renderElements(nodes, filteredRefs) {
  let html = '';
  for (const node of nodes) {
    const visible = filteredRefs ? nodeMatchesFilter(node, filteredRefs) : true;
    if (!visible) continue;
    const isSel = selectedRef === node.reference;
    const hasEV = ((node.scope_variables||[]).length + (node.selector_variables||[]).length) > 0;
    const kids = filteredRefs ? node.children.filter(c => nodeMatchesFilter(c, filteredRefs)) : node.children;
    if (kids.length) {
      html += '<details open><summary>';
      html += '<button class="node' + (isSel?' sel':'') + '" data-ref="' + esc(node.reference) + '">' + esc(node.element_name||'?') + '</button>';
      html += '<span class="el">elm</span>' + (hasEV ? '<span class="bv">V</span>' : '') + '<span class="cnt">(' + kids.length + ')</span>';
      html += '</summary><div class="ch">' + renderElements(kids, filteredRefs) + '</div></details>';
    } else {
      html += '<div class="leaf"><button class="node' + (isSel?' sel':'') + '" data-ref="' + esc(node.reference) + '">' + esc(node.element_name||'?') + '</button>';
      html += '<span class="el">elm</span>' + (hasEV ? '<span class="bv">V</span>' : '') + '</div>';
    }
  }
  return html;
}

function renderTree(entries, filter) {
  const q = (filter || '').toLowerCase().trim();
  const allNodes = entries;
  let filteredRefs = null;
  if (q) {
    filteredRefs = new Set();
    const match = e => (e.screen_name||'').toLowerCase().includes(q) || (e.element_name||'').toLowerCase().includes(q) || (e.url||'').toLowerCase().includes(q);
    for (const e of allNodes) if (match(e)) filteredRefs.add(e.reference);
    if (filteredRefs.size === 0) {
      document.getElementById('tree').innerHTML = '<div class="loading">No matches</div>';
      renderDetail(null);
      return;
    }
  }

  const invalid = entries.filter(e => e._validation_errors && e._validation_errors.length);
  const hier = buildHierarchy(entries);
  const treeEl = document.getElementById('tree');
  let html = '';
  if (invalid.length) {
    html += '<div style="color:var(--sol-red);padding:4px 6px;font-size:10px">⚠ ' + invalid.length + ' schema violation(s)</div>';
    for (const e of invalid) {
      const errs = e._validation_errors.map(v => v.field + ': ' + v.message).join('; ');
      html += '<div class="err" style="font-size:10px;padding:2px 6px">' + esc(errs) + '</div>';
    }
  }

  for (const app of hier) {
    const allScreens = app.versions.flatMap(v => v.screens);
    const visScreens = allScreens.filter(s =>
      !filteredRefs || nodeMatchesFilter(s, filteredRefs)
    );
    if (!visScreens.length) continue;
    const totalE = allScreens.reduce((n,s) => n + s.children.length, 0);
    html += '<details open><summary><strong>' + esc(app.name) + '</strong><span class="cnt">' + allScreens.length + 's/' + totalE + 'e</span></summary><div class="ch">';

    for (const ver of app.versions) {
      const verScreens = ver.screens.filter(s => !filteredRefs || nodeMatchesFilter(s, filteredRefs));
      if (!verScreens.length) continue;
      html += '<details open><summary><span class="ver">' + esc(ver.name) + '</span><span class="cnt ver-t">ver</span></summary><div class="ch">';

      for (const scr of verScreens) {
        const isSel = selectedRef === scr.reference;
        const hasVars = (scr.declared_variables||[]).length > 0;
        const visKids = filteredRefs ? scr.children.filter(c => nodeMatchesFilter(c, filteredRefs)) : scr.children;
        html += '<details ' + (isSel || visKids.length ? 'open' : '') + '><summary>';
        html += '<button class="node' + (isSel?' sel':'') + '" data-ref="' + esc(scr.reference) + '">' + esc(scr.screen_name||'?') + '</button>';
        html += '<span class="sc">scr</span>';
        if (hasVars) html += '<span class="bv">V</span>';
        if (visKids.length) html += '<span class="cnt">(' + visKids.length + ')</span>';
        html += '</summary><div class="ch">' + renderElements(visKids, filteredRefs) + '</div></details>';
      }
      html += '</div></details>';
    }
    html += '</div></details>';
  }
  treeEl.innerHTML = html || '<div class="loading">No entries</div>';
  treeEl.querySelectorAll('.node').forEach(btn => btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); selectRef(btn.dataset.ref); }));
}

function selectRef(ref) {
  selectedRef = ref;
  const entries = uisor?.entries || [];
  const entry = entries.find(e => e.reference === ref);
  document.querySelectorAll('.node').forEach(b => b.classList.toggle('sel', b.dataset.ref === ref));
  renderDetail(entry);
}

function entryCard(entry, compact) {
  const name = entry.screen_name || entry.element_name || '?';
  const badge = entry.type === 'screen' ? 'screen' : 'element';
  const img = entry.screenshot_data
    ? '<img src="data:' + (entry.screenshot_mime||'image/png') + ';base64,' + entry.screenshot_data +
      '" style="max-width:100%;display:block;border:1px solid var(--faint);margin-top:4px">'
    : '';
  if (compact) return '<div class="card"><span class="sel-badge ' + badge + '">' + badge.toUpperCase() + '</span> <strong>' + esc(name) + '</strong>' + img + '</div>';
  let rows = '';
  const row = (k, v) => { if (v != null && v !== '') rows += '<div class="dk">' + esc(k) + '</div><div class="dv">' + esc(String(v)) + '</div>'; };
  if (entry.type === 'screen') {
    row('url', entry.url); row('status', entry.status);
  } else {
    row('type', entry.element_type); row('search steps', entry.search_steps);
    row('visibility', entry.visibility);
    const sv = [...(entry.scope_variables||[]), ...(entry.selector_variables||[])];
    if (sv.length) row('variables', sv.map(v => v.name||v).join(', '));
    row('scope', entry.scope_selector);
  }
  const sel = entry.full_selector ? '<pre class="sel-code">' + esc(entry.full_selector) + '</pre>' : '';
  return '<div class="card"><span class="sel-badge ' + badge + '">' + badge.toUpperCase() + '</span> <strong>' + esc(name) + '</strong>' +
    img + (rows ? '<div class="dl" style="margin-top:6px">' + rows + '</div>' : '') + sel + '</div>';
}

function renderChildrenRecursive(parentRef, allEntries, depth) {
  const kids = allEntries.filter(e => e.parent_ref === parentRef);
  if (!kids.length) return '';
  return kids.map(c => {
    const ml = depth > 0 ? 'margin-left:' + (depth * 10) + 'px;' : '';
    return '<div class="card" style="' + ml + 'margin-bottom:4px">' +
      '<span class="sel-badge element">ELEMENT</span> <strong>' + esc(c.element_name || '?') + '</strong>' +
      (c.element_type ? ' <span class="cnt">' + esc(c.element_type) + '</span>' : '') +
      (c.screenshot_data ? '<img src="data:' + (c.screenshot_mime||'image/png') + ';base64,' + c.screenshot_data + '" style="max-width:100%;display:block;border:1px solid var(--faint);margin-top:4px">' : '') +
      '</div>' +
      renderChildrenRecursive(c.reference, allEntries, depth + 1);
  }).join('');
}

function renderDetail(entry) {
  const el = document.getElementById('detail');
  if (!entry) { el.className = 'empty'; el.innerHTML = ''; return; }
  el.className = '';
  const allEntries = uisor?.entries || [];
  const hasKids = allEntries.some(e => e.parent_ref === entry.reference);
  el.innerHTML = entryCard(entry, false) +
    (hasKids ? renderChildrenRecursive(entry.reference, allEntries, 0) : '');
}

// ── Reactive EventSource stream ────────────────────────────────────
let _es = null;
const _allEntries = [];
const _t0 = performance.now();

function connectStream() {
  if (_es) { _es.close(); }
  _allEntries.length = 0;
  uisor = null;
  document.getElementById('proj-name').textContent = 'Connecting…';
  document.getElementById('tree').innerHTML = '<div class="loading">Streaming…</div>';
  document.getElementById('detail').className = 'empty';

  _es = new EventSource(API + '/api/stream');

  _es.onmessage = function(e) {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    if (msg.type === 'header') {
      document.getElementById('proj-name').textContent = msg.project + ' (0)';
      return;
    }
    if (msg.type === 'done') {
      _es.close();
      const el = document.getElementById('proj-name');
      el.textContent = el.textContent.replace(/ \\(\\d+\\)$/, '') + ' (' + msg.total + ')';
      return;
    }
    if (msg.type === 'error') {
      document.getElementById('tree').innerHTML = '<div class="err">Stream error: ' + esc(msg.message) + '</div>';
      return;
    }

    if (msg._validation_errors) {
      console.warn('[schema] INVALID ref=' + (msg.reference||'?').slice(-12) +
        ' errors=' + JSON.stringify(msg._validation_errors));
    }
    _allEntries.push(msg);
    uisor = { entries: _allEntries };
    const pn = document.getElementById('proj-name');
    pn.textContent = pn.textContent.replace(/ \\(\\d+\\)$/, '') + ' (' + _allEntries.length + ')';
    renderTree(_allEntries);
  };

  _es.onerror = function() {
    document.getElementById('tree').innerHTML = '<div class="err">Stream error — click ↺ to retry</div>';
  };
}

document.getElementById('search').addEventListener('input', e => renderTree(uisor?.entries||[], e.target.value));
document.getElementById('refresh-btn').addEventListener('click', () => connectStream());
document.getElementById('export-btn').addEventListener('click', async () => {
  const btn = document.getElementById('export-btn');
  btn.textContent = '…';
  try {
    const r = await fetch(API + '/api/export/md');
    if (r.ok) { btn.textContent = '✓MD'; setTimeout(() => { btn.textContent = 'MD'; }, 2000); }
    else { btn.textContent = '✗MD'; }
  } catch { btn.textContent = '✗MD'; }
});

connectStream();
</script>
</body></html>`;
}

// ── webview layouts ───────────────────────────────────────────────────────────

function buildHtml(data, themeKind, viewId, port, repl) {
    const themeClass = themeKind === 1 ? 'light' : 'dark';
    if (viewId === 'cpmf-uipath-spike.sideView' || viewId === 'sideView') return buildInventorySideHtml(data.inventory, port, themeClass);
    return buildPanelHtml(data, themeClass, port, repl);
}

function buildPanelHtml(data, themeClass, port, repl) {
    const env   = data?.env   || {};
    const proj  = data?.project || {};
    const lic   = data?.license || {};
    const cmds  = data?.commands || [];

    const projectName = proj?.projectJson?.name || '(none)';
    const deps = proj?.projectJson?.dependencies
        ? Object.entries(proj.projectJson.dependencies)
            .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')
        : '<tr><td colspan="2">—</td></tr>';
    const files = (proj?.files || []).slice(0, 30)
        .map(f => `<li>${f}</li>`).join('');
    const uipathCmds = cmds.filter(c => /uipath/i.test(c))
        .map(c => `<li>${c}</li>`).join('') || '<li>(none)</li>';

    const licHtml = lic?.license?.body
        ? `<pre>${JSON.stringify(lic.license.body, null, 2)}</pre>`
        : `<p>${lic?.token === null ? 'No token — cannot reach Orchestrator' : 'Not fetched yet'}</p>`;

    return `<!DOCTYPE html>
<html lang="en" class="${themeClass}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<title>CPMForge: Service Explorer</title>
<style>${sharedCss()}
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .card { background: var(--bg2); padding: 10px; border-radius: 4px; border: 1px solid var(--faint); }
</style>
</head>
<body class="${themeClass}">
<h1>CPMForge: Service Explorer Spike</h1>

<div class="grid">
  <div class="card">
    <h2>Environment</h2>
    <table>
      <tr><th>Key</th><th>Value</th></tr>
      <tr><td>vscode.version</td><td>${env.version || '—'}</td></tr>
      <tr><td>appName</td><td>${env.appName || '—'}</td></tr>
      <tr><td>machineId</td><td>${env.machineId || '—'}</td></tr>
      <tr><td>Node.js</td><td>${env.node || '—'}</td></tr>
      <tr><td>CWD</td><td>${env.cwd || '—'}</td></tr>
      <tr><td>IPC pipe</td><td>${env.ipcPipe || '—'}</td></tr>
    </table>
  </div>

  <div class="card">
    <h2>Project: ${projectName}</h2>
    <table>
      <tr><th>Dependency</th><th>Version</th></tr>
      ${deps}
    </table>
  </div>
</div>

<h2>License (Orchestrator)</h2>
${licHtml}

<h2>Files (first 30)</h2>
<ul>${files}</ul>

<h2>UiPath commands</h2>
<ul>${uipathCmds}</ul>

<h2>Actions</h2>
<form action="http://127.0.0.1:${port}/refresh" method="post" style="display:inline">
  <button type="submit" style="background:var(--sol-blue);color:var(--bg);border:none;padding:5px 14px;cursor:pointer;font-size:11px">↺ Refresh data</button>
</form>

<h2>REPL <span style="color:var(--muted);font-size:10px;font-weight:normal">(Node.js · port ${port})</span></h2>
${repl ? `<pre style="border-left:3px solid ${repl.error ? 'var(--sol-red)' : 'var(--sol-green)'};background:var(--bg2);padding:8px;white-space:pre-wrap;margin-bottom:8px"><b>${repl.code.replace(/</g,'&lt;')}</b>\n${repl.value.replace(/</g,'&lt;')}</pre>` : ''}
<form action="http://127.0.0.1:${port}/eval" method="post">
  <textarea name="code" rows="3" style="width:100%;background:var(--bg2);color:var(--emph);border:1px solid var(--faint);padding:6px;font-family:inherit;font-size:11px;resize:vertical;box-sizing:border-box" placeholder="require('os').hostname()">${repl ? repl.code.replace(/</g,'&lt;') : ''}</textarea>
  <button type="submit" style="background:var(--sol-cyan);color:var(--bg);border:none;padding:5px 14px;cursor:pointer;font-size:11px;margin-top:4px">Run</button>
</form>
</body>
</html>`;
}

// ── entry point ───────────────────────────────────────────────────────────────

async function run(cmd, context) {
    try { fs.writeFileSync(LOG_FILE, ''); } catch {}

    log(`impl.js loaded fresh — running ${cmd}`);

    const data = {};

    if (cmd === 'cpmf-uipath-spike.dumpCommands') {
        data.commands = await dumpCommands();
    } else if (cmd === 'cpmf-uipath-spike.dumpInterop') {
        await dumpInterop();
    } else if (cmd === 'cpmf-uipath-spike.dumpProject') {
        data.project = await dumpProject();
    } else if (cmd === 'cpmf-uipath-spike.getLicense') {
        data.license = await dumpLicense();
    } else {
        // full dump
        data.env      = await dumpEnv();
        data.commands = await dumpCommands();
        data.project  = await dumpProject();
        await dumpInterop();
        data.license  = await dumpLicense();
    }

    try { fs.writeFileSync(DUMP_FILE, fs.readFileSync(LOG_FILE, 'utf-8')); } catch {}

    vscode.window.showInformationMessage(`CPMForge: Service Explorer done — ${DUMP_FILE}`);
}

async function resolveView(webviewView, context, viewId) {
    log(`resolveView called: ${viewId}`);
    let data = {};

    async function collectAndRender() {
        const implPath = require.resolve('./impl');
        delete require.cache[implPath];
        const fresh = require('./impl');
        data = {};
        data.env       = await fresh.dumpEnv();
        data.project   = await fresh.dumpProject();
        data.commands  = await fresh.dumpCommands();
        data.license   = await fresh.dumpLicense();
        data.keygen    = await fresh.dumpLicenseKeygen();
        data.inventory = await fresh.dumpInventory();
        render();
    }

    let _port = 0;
    let _repl = null;
    function render(port) {
        if (port) _port = port;
        const implPath = require.resolve('./impl');
        delete require.cache[implPath];
        const fresh = require('./impl');
        const kind = vscode.window.activeColorTheme?.kind ?? 2;
        webviewView.webview.html = fresh.buildHtml(data, kind, viewId, _port, _repl);
        log(`rendered viewId=${viewId} themeKind=${kind} port=${_port}`);
    }

    // HTTP server — webview uses fetch() since onDidReceiveMessage is broken in UiPath's host
    const http = require('http');
    const server = http.createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
        if (req.method === 'GET') {
            if (req.url === '/' || req.url.startsWith('/?') || req.url === '/index.html') {
                const themeClass = (vscode.window.activeColorTheme?.kind ?? 2) === 1 ? 'light' : 'dark';
                const implP = require.resolve('./impl');
                delete require.cache[implP];
                const freshApp = require('./impl');
                res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
                res.end(freshApp.buildInventoryAppHtml(themeClass, _port));
                return;
            }
            {
                const _implP = require.resolve('./impl');
                delete require.cache[_implP];
                const _fi = require('./impl');
                if (_fi.handleGet && _fi.handleGet(req, res, { data, vscode, log, _port })) return;
            }
            res.writeHead(404); res.end();
            return;
        }
        let body = '';
        req.on('data', d => body += d);
        req.on('end', async () => {
            if (req.url === '/refresh') {
                log('refresh via HTTP');
                collectAndRender()
                    .then(() => {
                        vscode.window.showInformationMessage(`CPMForge: Service Explorer refreshed — ${DUMP_FILE}`);
                        const implPath2 = require.resolve('./impl');
                        delete require.cache[implPath2];
                        const fresh2 = require('./impl');
                        const kind2 = vscode.window.activeColorTheme?.kind ?? 2;
                        const html = fresh2.buildHtml(data, kind2, viewId, _port, _repl);
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(html);
                    })
                    .catch(e => { log(`collectAndRender error: ${e?.message}`); res.writeHead(500); res.end(); });
                return;
            }
            const jsonMode = req.url === '/eval-json';
            if (req.url === '/eval' || req.url.startsWith('/eval?') || jsonMode) {
                let value, error = false;
                let code;
                try {
                    code = body.startsWith('{') ? JSON.parse(body).code
                        : decodeURIComponent(body.replace(/^code=/, '').replace(/\+/g, ' '));
                } catch { code = body; }
                if (!code?.trim()) {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('empty input');
                    return;
                }
                try {
                    const fn = new Function('require', 'vscode', 'fs', 'path', 'os', 'https',
                        `return (async()=>{ return (${code}) })()`);
                    const result = await fn(require, vscode, fs, path, os, https);
                    value = JSON.stringify(result, null, 2) ?? String(result);
                } catch (e) {
                    value = e?.message || String(e);
                    error = true;
                }
                log(`REPL: ${value?.slice(0, 200)}`);
                vscode.window.showInformationMessage(`CPMForge REPL: ${error ? 'ERR ' : ''}${value?.slice(0, 100)}`);
                _repl = { code, value, error };
                render();
                if (jsonMode) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ value, error }));
                } else {
                    const implPath2 = require.resolve('./impl');
                    delete require.cache[implPath2];
                    const fresh2 = require('./impl');
                    const kind2 = vscode.window.activeColorTheme?.kind ?? 2;
                    const html = fresh2.buildHtml(data, kind2, viewId, _port, _repl);
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(html);
                }
                return;
            }
            res.writeHead(404); res.end();
        });
    });
    server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        log(`HTTP server on port ${port}`);
        render(port);
    });
    context.subscriptions.push({ dispose: () => server.close() });

    await collectAndRender();

    // Watch impl.js — re-render on save (hot-reload)
    const implPath = require.resolve('./impl');
    const watcher = fs.watch(implPath, { persistent: false }, (event) => {
        log(`impl.js watcher event: ${event} — re-rendering ${viewId}`);
        try { render(); } catch (e) { log(`render error: ${e?.message}`); }
    });
    context.subscriptions.push({ dispose: () => watcher.close() });

    context.subscriptions.push(
        vscode.window.onDidChangeActiveColorTheme(() => render())
    );

    let wsTimer = null;
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(e => {
            const folders = vscode.workspace.workspaceFolders;
            log(`onDidChangeWorkspaceFolders: added=${e.added?.length} removed=${e.removed?.length} current=${folders?.length}`);
            clearTimeout(wsTimer);
            wsTimer = setTimeout(() => {
                const f = vscode.workspace.workspaceFolders;
                if (!f?.length) { log('workspace empty — skipping render'); return; }
                log(`debounce fired — re-collecting for: ${f[0].name}`);
                collectAndRender().catch(e2 => log(`collectAndRender error: ${e2?.message}`));
            }, 800);
        })
    );
}

// ── SSE stream handler — Node.js discovery, no Python ────────────────────

function _readMetaBom(dir) {
    const path = require('path'), fs = require('fs');
    try { return JSON.parse(fs.readFileSync(path.join(dir, '.metadata'), 'utf8').replace(/^﻿/, '')); } catch { return null; }
}
function _readType(dir) {
    const path = require('path'), fs = require('fs');
    try { return fs.readFileSync(path.join(dir, '.type'), 'utf8').trim(); } catch { return null; }
}
function _attrXml(xml, name) {
    const m = xml.match(new RegExp(name + '="([^"]*)"', 'i'));
    return m ? m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&') : '';
}
function _imageRef(xml) {
    const m = xml.match(/originalValue="([^"]+\.(?:png|jpg|jpeg))"/i);
    return m ? m[1] : null;
}
function _readContent(dir, dataFolder) {
    const path = require('path'), fs = require('fs');
    try { return fs.readFileSync(path.join(dir, '.data', dataFolder, '.content'), 'utf8'); } catch { return null; }
}

function _validateEntry(entry) {
    const errors = [];
    const common = ['type', 'reference', 'app_name', 'app_version', 'screen_name'];
    const required = entry.type === 'element' ? [...common, 'element_name'] : common;
    for (const f of required) {
        if (entry[f] === undefined || entry[f] === null || entry[f] === '')
            errors.push({ field: f, message: `required field "${f}" missing` });
    }
    if (entry.type !== 'screen' && entry.type !== 'element')
        errors.push({ field: 'type', message: `unknown type "${entry.type}"` });
    for (const f of ['has_image', 'has_cv']) {
        if (f in entry && typeof entry[f] !== 'boolean')
            errors.push({ field: f, message: 'must be boolean' });
    }
    return errors.length ? { ...entry, _validation_errors: errors } : entry;
}

function _discoverAll(objectsDir, onEntry) {
    const fs = require('fs'), path = require('path');
    function traverse(dir, ctx) {
        const type = _readType(dir);
        if (!type) return;
        const meta = _readMetaBom(dir);
        if (type === 'App' && meta) ctx = { ...ctx, appName: meta.Name };
        else if (type === 'AppVersion' && meta) ctx = { ...ctx, appVersion: meta.Name };
        else if (type === 'Screen' && meta) {
            ctx = { ...ctx, screenName: meta.Name };
            const xml = _readContent(dir, 'ObjectRepositoryScreenData');
            if (xml) onEntry({
                type: 'screen', reference: meta.Reference, parent_ref: meta.ParentRef || null,
                path: ctx.appName + '/' + ctx.appVersion + '/' + meta.Name,
                app_name: ctx.appName, app_version: ctx.appVersion, screen_name: meta.Name,
                url: _attrXml(xml, 'Url'), status: _attrXml(xml, 'Url').includes('{') ? 'parameterized' : 'hardcoded',
                selector: _attrXml(xml, 'Selector'), screenshot: _imageRef(xml),
                screenshot_width: null, screenshot_height: null, declared_variables: null,
                created: meta.Created || null, updated: meta.Updated || null,
            });
        } else if (type === 'Element' && meta) {
            const xml = _readContent(dir, 'ObjectRepositoryTargetData');
            if (xml) {
                const tagM = xml.match(/<(TargetAnchorable|TargetApp|TargetDescriptorBased)[^>]+>/i);
                const tagXml = tagM ? tagM[0] : xml;
                onEntry({
                    type: 'element', reference: meta.Reference, parent_ref: meta.ParentRef || null,
                    path: ctx.appName + '/' + ctx.appVersion + '/' + ctx.screenName + '/' + meta.Name,
                    app_name: ctx.appName, app_version: ctx.appVersion,
                    screen_name: ctx.screenName, element_name: meta.Name,
                    element_type: _attrXml(tagXml, 'ElementType'), activity_type: _attrXml(tagXml, 'ActivityType') || 'None',
                    search_steps: _attrXml(tagXml, 'SearchSteps') || 'Selector',
                    scope_selector: _attrXml(tagXml, 'ScopeSelectorArgument'),
                    full_selector: _attrXml(tagXml, 'FullSelectorArgument') || _attrXml(tagXml, 'Selector'),
                    fuzzy_selector: '', has_image: /FuzzyImage/i.test(xml), has_cv: /CVScreenId/i.test(tagXml),
                    cv_type: _attrXml(tagXml, 'CVType') || '', visibility: _attrXml(tagXml, 'Visibility') || '',
                    wait_for_ready: _attrXml(tagXml, 'WaitForReady') || '',
                    scope_variables: [], selector_variables: [],
                    screenshot: _imageRef(xml), screenshot_width: null, screenshot_height: null,
                    created: meta.Created || null, updated: meta.Updated || null,
                });
            }
        }
        let children;
        try { children = fs.readdirSync(dir).filter(n => !n.startsWith('.')); } catch { return; }
        for (const c of children) {
            const cp = path.join(dir, c);
            try { if (fs.statSync(cp).isDirectory()) traverse(cp, ctx); } catch {}
        }
    }
    traverse(objectsDir, { appName: '', appVersion: '', screenName: '' });
}

function handleGet(req, res, ctx) {
    const path = require('path'), fs = require('fs');
    const { vscode, log: _log } = ctx;

    if (req.url.startsWith('/api/stream')) {
        const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
        if (!wsPath) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No workspace open' }));
            return true;
        }
        const objectsDir = path.join(wsPath, '.objects');
        if (!fs.existsSync(objectsDir)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '.objects not found' }));
            return true;
        }

        let projectName = path.basename(wsPath);
        try { projectName = JSON.parse(fs.readFileSync(path.join(wsPath, 'project.json'), 'utf8').replace(/^﻿/, '')).name || projectName; } catch {}

        _log(`[sse] client connected ws=${wsPath}`);
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });

        const ssDir = path.join(wsPath, '.screenshots');
        const t0 = Date.now();
        let count = 0, aborted = false;

        function send(data) { if (!aborted) res.write('data: ' + JSON.stringify(data) + '\n\n'); }

        send({ type: 'header', project: projectName, schema_version: 'v0.1.2' });

        try {
            _discoverAll(objectsDir, entry => {
                if (aborted) return;
                if (entry.screenshot) {
                    const imgPath = path.join(ssDir, entry.screenshot);
                    try {
                        const d = fs.readFileSync(imgPath);
                        entry.screenshot_data = d.toString('base64');
                        entry.screenshot_mime = entry.screenshot.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
                    } catch {}
                }
                const validated = _validateEntry(entry);
                send(validated);
                count++;
            });
        } catch (e) { send({ type: 'error', message: e.message }); }

        const elapsed = Date.now() - t0;
        send({ type: 'done', total: count, elapsed_ms: elapsed });
        res.end();

        req.on('close', () => { aborted = true; });
        return true;
    }

    if (req.url.startsWith('/api/export/md')) {
        const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
        if (!wsPath) { res.writeHead(503); res.end('No workspace'); return true; }

        const objectsDir = path.join(wsPath, '.objects');
        let projectName = path.basename(wsPath);
        try { projectName = JSON.parse(fs.readFileSync(path.join(wsPath, 'project.json'), 'utf8').replace(/^﻿/, '')).name || projectName; } catch {}

        const entries = [];
        _discoverAll(objectsDir, e => entries.push(e));

        const appMap = new Map();
        for (const e of entries) {
            if (e.type === 'screen') {
                const appKey = e.app_name + '/' + e.app_version;
                if (!appMap.has(appKey)) appMap.set(appKey, { appName: e.app_name, appVersion: e.app_version, screens: [] });
                appMap.get(appKey).screens.push(e);
            }
        }

        const ssDir = path.join(wsPath, '.screenshots');

        function mdImg(screenshot) {
            if (!screenshot) return '';
            const imgPath = path.join(ssDir, screenshot);
            try {
                const mime = screenshot.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png';
                const b64 = fs.readFileSync(imgPath).toString('base64');
                return `\n![screenshot](data:${mime};base64,${b64})\n`;
            } catch { return ''; }
        }

        function mdElements(parentRef, depth) {
            const kids = entries.filter(e => e.type === 'element' && e.parent_ref === parentRef);
            if (!kids.length) return '';
            const indent = '  '.repeat(depth);
            let s = '';
            for (const k of kids) {
                s += `${indent}- **${k.element_name}**`;
                if (k.element_type) s += ` \`${k.element_type}\``;
                if (k.search_steps) s += ` — ${k.search_steps}`;
                s += '\n';
                if (k.screenshot) s += `${indent}  ${mdImg(k.screenshot).trim()}\n`;
                s += mdElements(k.reference, depth + 1);
            }
            return s;
        }

        let md = `# ${projectName} — Object Repository\n\nGenerated: ${new Date().toISOString()}\n\n`;
        md += `> Source: \`${wsPath}\`\n> Images: embedded as base64 data URIs\n\n`;
        for (const [, { appName, appVersion, screens }] of appMap) {
            md += `## ${appName} / ${appVersion}\n\n`;
            for (const scr of screens) {
                md += `### ${scr.screen_name} (Screen)\n\n`;
                if (scr.url) md += `URL: \`${scr.url}\`\n\n`;
                if (scr.selector) md += `Selector: \`${scr.selector}\`\n\n`;
                if (scr.screenshot) md += mdImg(scr.screenshot) + '\n';
                const elMd = mdElements(scr.reference, 0);
                if (elMd) md += `**Elements:**\n\n${elMd}\n`;
            }
        }

        const outDir = path.join(wsPath, 'Documentation', 'CPMForge');
        try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
        const outPath = path.join(outDir, projectName + '.md');
        fs.writeFileSync(outPath, md, 'utf8');

        res.writeHead(200, { 'Content-Type': 'text/markdown', 'Cache-Control': 'no-store' });
        res.end(md);
        return true;
    }

    return false;
}

module.exports = { run, resolveView, buildHtml, dumpEnv, dumpProject, dumpCommands, dumpLicense, dumpLicenseKeygen, dumpInventory, buildInventorySideHtml, buildInventoryAppHtml, handleGet };
