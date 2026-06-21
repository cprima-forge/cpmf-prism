// Keygen.sh license validation — pure Node https, no extra deps.
// Evolved from cpmf-uisor/src/license.ts; adds machine activation + typed response.

import * as https from 'https';
import * as path from 'path';
import { localAppDataDir, readText, writeText } from './storage';

const KEYGEN_ACCOUNT = 'cprima';
const KEYGEN_PRODUCT = '19c1f481-a383-4e9d-8714-40459788102b';
const KEYGEN_POLICY  = '27eef182-8d80-4daf-b3b2-4b58803289d4';

export interface ValidationResult {
    valid: boolean;
    code: string;
    message: string;
    licenseId?: string;
    expiry?: string;
    status?: string;
    machineCount?: number;
    maxMachines?: number | null;
}

export function getLicenseKeyPath(): string {
    return path.join(localAppDataDir(), 'license.key');
}

export function readLicenseKey(): string | null {
    return readText(getLicenseKeyPath());
}

export function saveLicenseKey(key: string): void {
    writeText(getLicenseKeyPath(), key);
}

function request<T>(method: string, url: string, auth?: string, body?: object): Promise<{ status: number; data: T }> {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : undefined;
        const req = https.request(url, {
            method,
            headers: {
                'Content-Type': 'application/vnd.api+json',
                'Accept': 'application/vnd.api+json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                ...(auth ? { 'Authorization': auth } : {}),
            },
        }, res => {
            let raw = '';
            res.on('data', c => (raw += c));
            res.on('end', () => {
                try { resolve({ status: res.statusCode ?? 0, data: (raw ? JSON.parse(raw) : {}) as T }); }
                catch { reject(new Error('parse error: ' + raw.slice(0, 120))); }
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function post<T>(url: string, body: object, auth?: string): Promise<{ status: number; data: T }> {
    return request<T>('POST', url, auth, body);
}

type ValidateResponse = {
    data?: {
        id?: string;
        attributes?: {
            expiry?: string;
            status?: string;
            maxMachines?: number | null;
        };
        relationships?: {
            machines?: { meta?: { count?: number } };
        };
    };
    meta?: {
        valid?: boolean;
        code?: string;
        detail?: string;
        scope?: { product?: string; policy?: string; fingerprint?: string };
    };
};

export async function validateLicense(
    key: string,
    fingerprint: string,
    log: (msg: string) => void,
): Promise<ValidationResult> {
    log(`[license] validate key=${key.slice(0, 6)}*** fp=${fingerprint}`);
    let result: { status: number; data: ValidateResponse };
    try {
        result = await post<ValidateResponse>(
            `https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT}/licenses/actions/validate-key`,
            { meta: { key, scope: { product: KEYGEN_PRODUCT, policy: KEYGEN_POLICY, fingerprint } } },
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`[license] request error: ${msg}`);
        return { valid: false, code: 'REQUEST_ERROR', message: msg };
    }

    const d = result.data;
    const valid       = d?.meta?.valid === true;
    const code        = d?.meta?.code ?? String(result.status);
    const message     = d?.meta?.detail ?? (valid ? 'Valid' : 'Invalid');
    const licenseId   = d?.data?.id;
    const expiry      = d?.data?.attributes?.expiry;
    const status      = d?.data?.attributes?.status;
    const machineCount = d?.data?.relationships?.machines?.meta?.count;
    const maxMachines  = d?.data?.attributes?.maxMachines;

    log(`[license] valid=${valid} code=${code} expiry=${expiry ?? 'n/a'} machines=${machineCount ?? '?'}/${maxMachines ?? '?'}`);
    return { valid, code, message, licenseId, expiry, status, machineCount, maxMachines };
}

type MachineListResponse = {
    data?: Array<{ id?: string; attributes?: { fingerprint?: string } }>;
    errors?: Array<{ detail?: string }>;
};

export async function deactivateMachine(
    licenseKey: string,
    fingerprint: string,
    log: (msg: string) => void,
): Promise<{ ok: boolean; message: string }> {
    log(`[license] deactivate machine fp=${fingerprint}`);
    try {
        const list = await request<MachineListResponse>(
            'GET',
            `https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT}/machines?fingerprint=${encodeURIComponent(fingerprint)}&limit=1`,
            `License ${licenseKey}`,
        );
        const machineId = list.data?.data?.[0]?.id;
        if (!machineId) {
            log('[license] deactivate: no machine found for fingerprint');
            return { ok: false, message: 'No machine found for this fingerprint' };
        }
        const del = await request<unknown>(
            'DELETE',
            `https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT}/machines/${machineId}`,
            `License ${licenseKey}`,
        );
        const ok = del.status === 204 || del.status === 200;
        log(`[license] deactivate status=${del.status} ok=${ok}`);
        return { ok, message: ok ? 'Machine deactivated' : `HTTP ${del.status}` };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`[license] deactivate error: ${msg}`);
        return { ok: false, message: msg };
    }
}

type MachineCreateResponse = {
    data?: { id?: string };
    errors?: Array<{ detail?: string; code?: string }>;
};

// Activate this machine against a validated license.
// licenseId: the UUID from validateLicense (data.id), not the human key.
export async function activateMachine(
    licenseId: string,
    licenseKey: string,
    fingerprint: string,
    machineName: string,
    log: (msg: string) => void,
): Promise<{ ok: boolean; message: string; machineId?: string }> {
    log(`[license] activate machine licenseId=${licenseId.slice(0, 8)}*** fp=${fingerprint}`);
    try {
        const result = await post<MachineCreateResponse>(
            `https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT}/machines`,
            {
                data: {
                    type: 'machines',
                    attributes: { fingerprint, name: machineName },
                    relationships: {
                        license: { data: { type: 'licenses', id: licenseId } },
                    },
                },
            },
            `License ${licenseKey}`,
        );
        const ok = result.status === 201 || result.status === 200;
        const machineId = result.data?.data?.id;
        const msg = result.data?.errors?.[0]?.detail ?? (ok ? 'activated' : `HTTP ${result.status}`);
        log(`[license] machine activate ok=${ok} msg=${msg}`);
        return { ok, message: msg, machineId };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`[license] machine activate error: ${msg}`);
        return { ok: false, message: msg };
    }
}
