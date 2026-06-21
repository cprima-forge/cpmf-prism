// UiPath .objects/ directory tree discovery — Node.js, no subprocess.
// All entries conform to uipath-object-repository schema v0.1.2.

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

// ── XML attribute helpers ─────────────────────────────────────────────────────

function attr(xml: string, name: string): string {
    const m = xml.match(new RegExp(`${name}="([^"]*)"`, 'i'));
    if (!m) return '';
    return m[1]
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function attrOpt(xml: string, name: string): string | null {
    return new RegExp(`${name}="([^"]*)"`, 'i').test(xml) ? attr(xml, name) : null;
}

function imageRef(xml: string): string | null {
    const m = xml.match(/originalValue="([^"]+\.(?:png|jpg|jpeg))"/i);
    return m ? m[1] : null;
}

// ── .metadata / .type / .content readers ─────────────────────────────────────

interface NodeMeta {
    Name: string;
    Type: string;
    Reference: string;
    ParentRef: string | null;
    Created: string | null;
    Updated: string | null;
}

function readMeta(dir: string): NodeMeta | null {
    try {
        const raw = fs.readFileSync(path.join(dir, '.metadata'), 'utf8').replace(/^﻿/, '');
        return JSON.parse(raw) as NodeMeta;
    } catch { return null; }
}

function readType(dir: string): string | null {
    try { return fs.readFileSync(path.join(dir, '.type'), 'utf8').trim(); }
    catch { return null; }
}

function readContent(dir: string, dataFolderName: string): string | null {
    try { return fs.readFileSync(path.join(dir, '.data', dataFolderName, '.content'), 'utf8'); }
    catch { return null; }
}

// ── Entry parsers ─────────────────────────────────────────────────────────────

function parseScreen(dir: string, meta: NodeMeta, appName: string, appVersion: string): ScreenEntry | null {
    const xml = readContent(dir, 'ObjectRepositoryScreenData');
    if (!xml) return null;
    const url = attr(xml, 'Url');
    return {
        type: 'screen',
        reference: meta.Reference,
        parent_ref: meta.ParentRef,
        path: `${appName}/${appVersion}/${meta.Name}`,
        app_name: appName,
        app_version: appVersion,
        screen_name: meta.Name,
        url,
        status: url.includes('{') ? 'parameterized' : 'hardcoded',
        selector: attr(xml, 'Selector'),
        screenshot: imageRef(xml),
        screenshot_width: null,
        screenshot_height: null,
        declared_variables: null,
        created: meta.Created,
        updated: meta.Updated,
    };
}

function parseElement(
    dir: string, meta: NodeMeta,
    appName: string, appVersion: string, screenName: string,
): ElementEntry | null {
    const xml = readContent(dir, 'ObjectRepositoryTargetData');
    if (!xml) return null;
    const tagMatch = xml.match(/<(TargetAnchorable|TargetApp|TargetDescriptorBased)[^>]+>/i);
    const tag = tagMatch ? tagMatch[0] : xml;
    const fullSelector  = attr(tag, 'FullSelectorArgument') || attr(tag, 'Selector');
    const scopeSelector = attr(tag, 'ScopeSelectorArgument');
    return {
        type: 'element',
        reference: meta.Reference,
        parent_ref: meta.ParentRef,
        path: `${appName}/${appVersion}/${screenName}/${meta.Name}`,
        app_name: appName,
        app_version: appVersion,
        screen_name: screenName,
        element_name: meta.Name,
        element_type: attr(tag, 'ElementType'),
        activity_type: attrOpt(tag, 'ActivityType') ?? 'None',
        search_steps: attr(tag, 'SearchSteps') || 'Selector',
        scope_selector: scopeSelector,
        full_selector: fullSelector,
        fuzzy_selector: '',
        has_image: /<imageRef\s[^>]*attrName="FuzzyImage/i.test(xml),
        has_cv: /<imageRef\s[^>]*attrName="CV/i.test(xml) || /CVScreenId/i.test(tag),
        cv_type: attrOpt(tag, 'CVType') ?? '',
        visibility: attr(tag, 'Visibility'),
        wait_for_ready: attr(tag, 'WaitForReady'),
        scope_variables:    [...scopeSelector.matchAll(/\{([^}]+)\}/g)].map(m => m[1]),
        selector_variables: [...fullSelector.matchAll(/\{([^}]+)\}/g)].map(m => m[1]),
        screenshot: imageRef(xml),
        screenshot_width: null,
        screenshot_height: null,
        created: meta.Created,
        updated: meta.Updated,
    };
}

// ── Traversal ─────────────────────────────────────────────────────────────────

interface Ctx { appName: string; appVersion: string; screenName: string; }

function traverse(dir: string, ctx: Ctx, onEntry: (e: Entry) => void): void {
    const type = readType(dir);
    if (!type) return;
    const meta = readMeta(dir);

    if      (type === 'App'        && meta) { ctx = { ...ctx, appName:    meta.Name }; }
    else if (type === 'AppVersion' && meta) { ctx = { ...ctx, appVersion: meta.Name }; }
    else if (type === 'Screen'     && meta) {
        ctx = { ...ctx, screenName: meta.Name };
        const e = parseScreen(dir, meta, ctx.appName, ctx.appVersion);
        if (e) onEntry(e);
    } else if (type === 'Element'  && meta) {
        const e = parseElement(dir, meta, ctx.appName, ctx.appVersion, ctx.screenName);
        if (e) onEntry(e);
    }

    let children: string[];
    try { children = fs.readdirSync(dir).filter(n => !n.startsWith('.')); }
    catch { return; }

    for (const child of children) {
        const childDir = path.join(dir, child);
        try { if (fs.statSync(childDir).isDirectory()) traverse(childDir, ctx, onEntry); }
        catch { /* skip inaccessible */ }
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function discoverAll(objectsDir: string, onEntry?: (e: Entry) => void): Entry[] {
    const entries: Entry[] = [];
    traverse(objectsDir, { appName: '', appVersion: '', screenName: '' }, e => {
        entries.push(e);
        onEntry?.(e);
    });
    return entries;
}
