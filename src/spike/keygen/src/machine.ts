// Machine identity — generated once, persisted across 3 independent stores:
//   1. HKLM\Software\CPMForge\cpmf-keygen-spike  (MachineId)
//   2. %PROGRAMDATA%\CPMForge\cpmf-keygen-spike\machine.id
//   3. %LOCALAPPDATA%\CPMForge\cpmf-keygen-spike\machine.id
//
// Consensus: any valid UUID found → reuse; all missing → generate fresh.
// All stores are backfilled on every activation.

import * as crypto from 'crypto';
import * as path from 'path';
import { programDataDir, localAppDataDir, readText, writeText } from './storage';
import { readRegistry, writeRegistry } from './registry';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
    return UUID_RE.test(s);
}

export function getMachineId(log: (msg: string) => void): string {
    const pdFile  = path.join(programDataDir(), 'machine.id');
    const ladFile = path.join(localAppDataDir(), 'machine.id');

    const fromReg = readRegistry('MachineId');
    const fromPD  = readText(pdFile);
    const fromLAD = readText(ladFile);

    const candidates = ([fromReg, fromPD, fromLAD] as Array<string | null>)
        .filter((v): v is string => typeof v === 'string' && isUuid(v));

    // Consensus: most-common value wins (guards against single-source corruption)
    const counts = new Map<string, number>();
    for (const c of candidates) counts.set(c, (counts.get(c) ?? 0) + 1);
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

    const machineId = best ? best[0] : crypto.randomUUID();
    const isNew = !best;

    log(`[machine] id=${machineId.slice(0, 8)}*** sources=${candidates.length}/3 new=${isNew}`);

    // Backfill any missing or mismatched store
    if (fromReg !== machineId) {
        const r = writeRegistry('MachineId', machineId);
        log(`[machine] reg write hklm=${r.hklm} wow=${r.wow} hkcu=${r.hkcu}`);
    }
    if (fromPD !== machineId) {
        try { writeText(pdFile, machineId); }
        catch (e) { log(`[machine] ProgramData write failed: ${e}`); }
    }
    if (fromLAD !== machineId) {
        writeText(ladFile, machineId);
    }

    return machineId;
}

// Convert UUID to colon-separated hex pairs — matches Keygen fingerprint format
export function fingerprintFromMachineId(machineId: string): string {
    return machineId.replace(/-/g, '').match(/.{2}/g)!.slice(0, 8).join(':').toUpperCase();
}

export function signRecord(data: object, machineId: string): string {
    return crypto.createHmac('sha256', machineId).update(JSON.stringify(data)).digest('hex');
}

export function verifyRecord(data: object, machineId: string, sig: string): boolean {
    const expected = signRecord(data, machineId);
    try {
        return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
    } catch {
        return false;
    }
}
