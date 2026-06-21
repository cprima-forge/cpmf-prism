import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const VENDOR = 'CPMForge';
const APP    = 'cpmf-keygen-spike';

export function programDataDir(): string {
    const pd = process.env['PROGRAMDATA'] ?? path.join('C:', 'ProgramData');
    return path.join(pd, VENDOR, APP);
}

export function localAppDataDir(): string {
    const lad = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
    return path.join(lad, VENDOR, APP);
}

export function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

export function readJson<T>(filePath: string): T | null {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    } catch {
        return null;
    }
}

export function writeJson(filePath: string, data: unknown): void {
    ensureDir(path.dirname(filePath));
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
}

export function readText(filePath: string): string | null {
    try {
        return fs.readFileSync(filePath, 'utf8').trim();
    } catch {
        return null;
    }
}

export function writeText(filePath: string, text: string): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, text, 'utf8');
}

export function appendLog(logsDir: string, message: string): void {
    try {
        ensureDir(logsDir);
        const today = new Date().toISOString().slice(0, 10);
        const logFile = path.join(logsDir, `${today}.log`);
        fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`, 'utf8');
    } catch { /* best effort */ }
}
