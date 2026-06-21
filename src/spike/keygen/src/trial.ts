// Trial enforcement — multi-layer anti-reset.
//
// Trial start stored in 4 independent locations:
//   1. %PROGRAMDATA%\...\activation.json  (requires admin to delete)
//   2. %LOCALAPPDATA%\...\cache.json      (user-deletable — the weak one)
//   3. HKLM\Software\...\TrialStart       (requires admin to delete)
//   4. Keygen server (machine metadata)   — set trial start as machine attribute on activation
//
// All values must agree. Any mismatch or missing source → tamperedSources[] grows.
// Tamper → trial disabled regardless of elapsed days.

import * as path from 'path';
import { programDataDir, localAppDataDir, readJson, writeJson } from './storage';
import { readRegistry, writeRegistry } from './registry';
import { signRecord, verifyRecord } from './machine';

const TRIAL_DAYS = 14;

interface StoredRecord {
    trialStart: string;
    machineId: string;
    sig: string;
}

export interface TrialStatus {
    active: boolean;
    daysRemaining: number;
    daysElapsed: number;
    trialStart: string | null;
    tampered: boolean;
    tamperedSources: string[];
}

function activationPath(): string {
    return path.join(programDataDir(), 'activation.json');
}

function cachePath(): string {
    return path.join(localAppDataDir(), 'cache.json');
}

function daysDiff(isoStart: string): number {
    return Math.floor((Date.now() - new Date(isoStart).getTime()) / 86_400_000);
}

function makeRecord(trialStart: string, machineId: string): StoredRecord {
    const payload = { trialStart, machineId };
    return { ...payload, sig: signRecord(payload, machineId) };
}

function verifyStoredRecord(rec: StoredRecord, expectedMachineId: string, source: string, tamperedSources: string[]): void {
    if (rec.machineId !== expectedMachineId) {
        tamperedSources.push(`${source}-machineId-mismatch`);
        return;
    }
    const { sig, ...data } = rec;
    if (!verifyRecord(data, expectedMachineId, sig)) {
        tamperedSources.push(`${source}-sig-invalid`);
    }
}

export function startTrial(machineId: string, log: (msg: string) => void): string {
    const trialStart = new Date().toISOString();
    const record = makeRecord(trialStart, machineId);

    try {
        writeJson(activationPath(), record);
        log('[trial] wrote ProgramData/activation.json');
    } catch (e) {
        log(`[trial] ProgramData write failed (no admin?): ${e}`);
    }

    writeJson(cachePath(), record);
    log('[trial] wrote LocalAppData/cache.json');

    const r = writeRegistry('TrialStart', trialStart);
    log(`[trial] registry TrialStart hklm=${r.hklm} wow=${r.wow} hkcu=${r.hkcu}`);

    return trialStart;
}

export function checkTrial(machineId: string, log: (msg: string) => void): TrialStatus {
    const fromPD  = readJson<StoredRecord>(activationPath());
    const fromLAD = readJson<StoredRecord>(cachePath());
    const fromReg = readRegistry('TrialStart');

    const tamperedSources: string[] = [];

    // Verify HMAC signatures
    if (fromPD)  verifyStoredRecord(fromPD,  machineId, 'ProgramData',  tamperedSources);
    if (fromLAD) verifyStoredRecord(fromLAD, machineId, 'LocalAppData', tamperedSources);

    // Cross-source consistency: all present values must match
    const starts = [fromPD?.trialStart, fromLAD?.trialStart, fromReg]
        .filter((v): v is string => typeof v === 'string');
    const unique = new Set(starts);
    if (unique.size > 1) {
        log(`[trial] cross-source mismatch: ${[...unique].join(' | ')}`);
        tamperedSources.push('cross-source-mismatch');
    }

    // Deletion detection heuristics
    if (!fromPD && fromLAD) tamperedSources.push('ProgramData-missing');
    if (!fromLAD && fromPD) tamperedSources.push('LocalAppData-missing');
    if (!fromReg && (fromPD || fromLAD)) tamperedSources.push('Registry-missing');

    const tampered = tamperedSources.length > 0;

    if (starts.length === 0) {
        log('[trial] no record — fresh install');
        return { active: false, daysRemaining: 0, daysElapsed: 0, trialStart: null, tampered, tamperedSources };
    }

    // Use earliest date across sources (conservative)
    const trialStart = [...starts].sort()[0];
    const elapsed    = daysDiff(trialStart);
    const remaining  = Math.max(0, TRIAL_DAYS - elapsed);
    const active     = remaining > 0 && !tampered;

    log(`[trial] start=${trialStart} elapsed=${elapsed}d remaining=${remaining}d tampered=${tampered}`);
    if (tamperedSources.length) log(`[trial] tampered sources: ${tamperedSources.join(', ')}`);

    return { active, daysRemaining: remaining, daysElapsed: elapsed, trialStart, tampered, tamperedSources };
}
