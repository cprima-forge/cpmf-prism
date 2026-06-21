// Null-op license stub. Replace with keygen.sh implementation from src/spike/keygen/ when ready.

export { requireEntitlement } from './guard';

export interface ValidationResult {
    valid: boolean;
    code: string;
    message: string;
}

export async function validateLicense(
    _fingerprint: string,
    log: (msg: string) => void,
): Promise<ValidationResult> {
    log('[license] null-op: skipping validation');
    return { valid: true, code: 'NULL_OP', message: 'License enforcement not active' };
}

export function getLicensePath(): string {
    return '(null-op: no license file)';
}
