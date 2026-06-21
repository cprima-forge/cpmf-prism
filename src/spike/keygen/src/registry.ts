// Windows registry via reg.exe — no native modules.
// Write order: HKLM → WOW6432Node → HKCU (fallback when no admin).

import { execSync } from 'child_process';

const HKLM     = 'HKLM\\Software\\CPMForge\\cpmf-keygen-spike';
const HKLM_WOW = 'HKLM\\Software\\WOW6432Node\\CPMForge\\cpmf-keygen-spike';
const HKCU     = 'HKCU\\Software\\CPMForge\\cpmf-keygen-spike';

function regQuery(key: string, name: string): string | null {
    try {
        const out = execSync(`reg query "${key}" /v "${name}"`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const m = out.match(/REG_SZ\s+(.+)/);
        return m ? m[1].trim() : null;
    } catch {
        return null;
    }
}

function regWrite(key: string, name: string, value: string): boolean {
    try {
        execSync(`reg add "${key}" /v "${name}" /t REG_SZ /d "${value}" /f`, {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return true;
    } catch {
        return false;
    }
}

export interface RegWriteResult {
    hklm: boolean;
    wow: boolean;
    hkcu: boolean;
}

export function readRegistry(name: string): string | null {
    return regQuery(HKLM, name)
        ?? regQuery(HKLM_WOW, name)
        ?? regQuery(HKCU, name);
}

export function writeRegistry(name: string, value: string): RegWriteResult {
    const hklm = regWrite(HKLM, name, value);
    const wow  = regWrite(HKLM_WOW, name, value);
    // HKCU always written as fallback regardless of HKLM success
    const hkcu = regWrite(HKCU, name, value);
    return { hklm, wow, hkcu };
}
