// Keygen.sh license validation — no Python, pure Node.js https.
// Key stored in %LOCALAPPDATA%\cpmf-uisor\license.key (NOT Studio folder).

import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const KEYGEN_ACCOUNT = 'cprima';
const KEYGEN_PRODUCT = '19c1f481-a383-4e9d-8714-40459788102b';
const KEYGEN_POLICY  = '27eef182-8d80-4daf-b3b2-4b58803289d4';
const LICENSE_PATH   = path.join(os.homedir(), 'AppData', 'Local', 'cpmf-uisor', 'license.key');

export interface ValidationResult {
    valid: boolean;
    code: string;
    message: string;
}

function readKey(): string | null {
    try {
        return fs.readFileSync(LICENSE_PATH, 'utf8').trim();
    } catch {
        return null;
    }
}

function post(url: string, body: object): Promise<{ status: number; data: unknown }> {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const options: https.RequestOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/vnd.api+json',
                'Accept': 'application/vnd.api+json',
                'Content-Length': Buffer.byteLength(payload),
            },
        };
        const req = https.request(url, options, res => {
            let raw = '';
            res.on('data', chunk => (raw += chunk));
            res.on('end', () => {
                try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }); }
                catch { reject(new Error('Response parse error: ' + raw.slice(0, 100))); }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

export async function validateLicense(
    fingerprint: string,
    log: (msg: string) => void,
): Promise<ValidationResult> {
    const key = readKey();
    if (!key) {
        log(`[license] key file not found at ${LICENSE_PATH}`);
        return { valid: false, code: 'KEY_NOT_FOUND', message: `License key not found at ${LICENSE_PATH}` };
    }

    // Never log the full key — only first 6 chars
    log(`[license] validating key=${key.slice(0, 6)}*** fingerprint=${fingerprint}`);

    let result: { status: number; data: unknown };
    try {
        result = await post(
            `https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT}/licenses/actions/validate-key`,
            {
                meta: {
                    key,
                    scope: {
                        product: KEYGEN_PRODUCT,
                        policy: KEYGEN_POLICY,
                        fingerprint,
                    },
                },
            },
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`[license] request error: ${msg}`);
        return { valid: false, code: 'REQUEST_ERROR', message: msg };
    }

    const data = result.data as { meta?: { valid?: boolean; code?: string; detail?: string } };
    const valid = data?.meta?.valid === true;
    const code  = data?.meta?.code  ?? String(result.status);
    const message = data?.meta?.detail ?? (valid ? 'Valid' : 'Invalid');

    log(`[license] valid=${valid} code=${code}`);
    return { valid, code, message };
}

export function getLicensePath(): string {
    return LICENSE_PATH;
}
