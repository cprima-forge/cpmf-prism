// Node.js discovery for UiPath .objects/ directory tree.
// Reads .type, .metadata, and .data/[name]/.content files — no Python, no subprocess.
// Schema contract: entries conform to uisor-schema-v0.1.2.json

import * as fs from 'fs';
import * as path from 'path';

export interface VariableDecl {
    name: string;
    default?: string;
}

export interface ScreenEntry {
    type: 'screen';
    reference: string;
    parent_ref: string | null;
    path: string;
    app_name: string;
    app_version: string;
    screen_name: string;
    url: string;
    status: 'hardcoded' | 'parameterized';
    selector: string;
    screenshot: string | null;
    screenshot_width: number | null;
    screenshot_height: number | null;
    declared_variables: VariableDecl[] | null;
    created: string | null;
    updated: string | null;
}

export interface ElementEntry {
    type: 'element';
    reference: string;
    parent_ref: string | null;
    path: string;
    app_name: string;
    app_version: string;
    screen_name: string;
    element_name: string;
    element_type: string;
    activity_type: string;
    search_steps: string;
    scope_selector: string;
    full_selector: string;
    fuzzy_selector: string;
    has_image: boolean;
    has_cv: boolean;
    cv_type: string;
    visibility: string;
    wait_for_ready: string;
    scope_variables: string[];
    selector_variables: string[];
    screenshot: string | null;
    screenshot_width: number | null;
    screenshot_height: number | null;
    created: string | null;
    updated: string | null;
}

export type Entry = ScreenEntry | ElementEntry;

export interface Inventory {
    schema_version: 'v0.1.2';
    project: { name: string; path: string };
    entries: Entry[];
}

// ── XML attribute extraction ──────────────────────────────────────────────────

function attr(xml: string, name: string): string {
    const re = new RegExp(`${name}="([^"]*)"`, 'i');
    const m = xml.match(re);
    if (!m) return '';
    // decode XML entities
    return m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function attrOpt(xml: string, name: string): string | null {
    const re = new RegExp(`${name}="([^"]*)"`, 'i');
    return re.test(xml) ? attr(xml, name) : null;
}

function imageRef(xml: string): string | null {
    const m = xml.match(/originalValue="([^"]+\.(?:png|jpg|jpeg))"/i);
    return m ? m[1] : null;
}

// ── Metadata (JSON) ───────────────────────────────────────────────────────────

interface NodeMeta {
    Name: string;
    Type: string;
    Id: string;
    Reference: string;
    ParentRef: string | null;
    Created: string | null;
    Updated: string | null;
}

function readMeta(dir: string): NodeMeta | null {
    const p = path.join(dir, '.metadata');
    try {
        // Strip UTF-8 BOM (EF BB BF) that UiPath writes before JSON
        const raw = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
        return JSON.parse(raw) as NodeMeta;
    } catch {
        return null;
    }
}

function readType(dir: string): string | null {
    try {
        return fs.readFileSync(path.join(dir, '.type'), 'utf8').trim();
    } catch {
        return null;
    }
}

function readContent(dir: string, dataFolderName: string): string | null {
    const p = path.join(dir, '.data', dataFolderName, '.content');
    try {
        return fs.readFileSync(p, 'utf8');
    } catch {
        return null;
    }
}

// ── Screen parser ─────────────────────────────────────────────────────────────

function parseScreen(
    dir: string,
    meta: NodeMeta,
    appName: string,
    appVersion: string,
): ScreenEntry | null {
    const xml = readContent(dir, 'ObjectRepositoryScreenData');
    if (!xml) return null;

    const selector = attr(xml, 'Selector');
    const url = attr(xml, 'Url');
    const status: 'hardcoded' | 'parameterized' = url.includes('{') ? 'parameterized' : 'hardcoded';
    const screenshot = imageRef(xml);

    return {
        type: 'screen',
        reference: meta.Reference,
        parent_ref: meta.ParentRef,
        path: `${appName}/${appVersion}/${meta.Name}`,
        app_name: appName,
        app_version: appVersion,
        screen_name: meta.Name,
        url,
        status,
        selector,
        screenshot,
        screenshot_width: null,
        screenshot_height: null,
        declared_variables: null,
        created: meta.Created,
        updated: meta.Updated,
    };
}

// ── Element parser ────────────────────────────────────────────────────────────

function parseElement(
    dir: string,
    meta: NodeMeta,
    appName: string,
    appVersion: string,
    screenName: string,
): ElementEntry | null {
    const xml = readContent(dir, 'ObjectRepositoryTargetData');
    if (!xml) return null;

    // TargetAnchorable or TargetApp element
    const tagMatch = xml.match(/<(TargetAnchorable|TargetApp|TargetDescriptorBased)[^>]+>/i);
    const tagXml = tagMatch ? tagMatch[0] : xml;

    const fullSelector = attr(tagXml, 'FullSelectorArgument') || attr(tagXml, 'Selector');
    const scopeSelector = attr(tagXml, 'ScopeSelectorArgument') || '';
    const elementType = attr(tagXml, 'ElementType') || '';
    const activityType = attrOpt(tagXml, 'ActivityType') ?? 'None';
    const searchSteps = attr(tagXml, 'SearchSteps') || 'Selector';
    const visibility = attr(tagXml, 'Visibility') || '';
    const waitForReady = attr(tagXml, 'WaitForReady') || '';
    const hasImage = /<imageRef\s[^>]*attrName="FuzzyImage/i.test(xml);
    const hasCv = /<imageRef\s[^>]*attrName="CV/i.test(xml) || /CVScreenId/i.test(tagXml);
    const cvType = attrOpt(tagXml, 'CVType') ?? '';

    // Variable extraction from x:Key bindings
    const scopeVarMatches = [...scopeSelector.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
    const selectorVarMatches = [...fullSelector.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);

    return {
        type: 'element',
        reference: meta.Reference,
        parent_ref: meta.ParentRef,
        path: `${appName}/${appVersion}/${screenName}/${meta.Name}`,
        app_name: appName,
        app_version: appVersion,
        screen_name: screenName,
        element_name: meta.Name,
        element_type: elementType,
        activity_type: activityType,
        search_steps: searchSteps,
        scope_selector: scopeSelector,
        full_selector: fullSelector,
        fuzzy_selector: '',
        has_image: hasImage,
        has_cv: hasCv,
        cv_type: cvType,
        visibility,
        wait_for_ready: waitForReady,
        scope_variables: scopeVarMatches,
        selector_variables: selectorVarMatches,
        screenshot: imageRef(xml),
        screenshot_width: null,
        screenshot_height: null,
        created: meta.Created,
        updated: meta.Updated,
    };
}

// ── Recursive traversal ───────────────────────────────────────────────────────

interface Context {
    appName: string;
    appVersion: string;
    screenName: string;
}

function traverse(
    dir: string,
    ctx: Context,
    onEntry: (entry: Entry) => void,
): void {
    const type = readType(dir);
    if (!type) return;

    const meta = readMeta(dir);

    if (type === 'App' && meta) {
        ctx = { ...ctx, appName: meta.Name };
    } else if (type === 'AppVersion' && meta) {
        ctx = { ...ctx, appVersion: meta.Name };
    } else if (type === 'Screen' && meta) {
        ctx = { ...ctx, screenName: meta.Name };
        const entry = parseScreen(dir, meta, ctx.appName, ctx.appVersion);
        if (entry) onEntry(entry);
    } else if (type === 'Element' && meta) {
        const entry = parseElement(dir, meta, ctx.appName, ctx.appVersion, ctx.screenName);
        if (entry) onEntry(entry);
    }

    // Recurse into subdirectories (skip dot-files)
    let children: string[];
    try {
        children = fs.readdirSync(dir).filter(n => !n.startsWith('.'));
    } catch {
        return;
    }
    for (const child of children) {
        const childDir = path.join(dir, child);
        try {
            if (fs.statSync(childDir).isDirectory()) {
                traverse(childDir, ctx, onEntry);
            }
        } catch { /* skip inaccessible */ }
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function discoverAll(objectsDir: string, onEntry?: (entry: Entry) => void): Entry[] {
    const entries: Entry[] = [];
    const ctx: Context = { appName: '', appVersion: '', screenName: '' };
    traverse(objectsDir, ctx, entry => {
        entries.push(entry);
        onEntry?.(entry);
    });
    return entries;
}

export function buildInventory(projectRoot: string): Inventory {
    const projectJsonPath = path.join(projectRoot, 'project.json');
    let projectName = path.basename(projectRoot);
    try {
        const pj = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8')) as { name?: string };
        projectName = pj.name ?? projectName;
    } catch { /* ignore */ }

    const objectsDir = path.join(projectRoot, '.objects');
    const entries = discoverAll(objectsDir);

    return {
        schema_version: 'v0.1.2',
        project: { name: projectName, path: projectRoot },
        entries,
    };
}
