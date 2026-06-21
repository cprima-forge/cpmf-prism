// Lightweight schema boundary validation for inventory entries (v0.1.2).
// No external deps. Invalid entries pass through with _validation_errors populated.

export interface ValidationError { field: string; message: string; }
export interface ValidatedEntry { _validation_errors?: ValidationError[]; [key: string]: unknown; }

const COMMON = ['type', 'reference', 'app_name', 'app_version', 'screen_name'] as const;

function checkRequired(entry: Record<string, unknown>, fields: readonly string[]): ValidationError[] {
    return fields
        .filter(f => entry[f] === undefined || entry[f] === null || entry[f] === '')
        .map(f => ({ field: f, message: `required field "${f}" missing or empty` }));
}

function checkTypes(entry: Record<string, unknown>): ValidationError[] {
    const errors: ValidationError[] = [];
    if (typeof entry['reference'] !== 'string')
        errors.push({ field: 'reference', message: 'must be string' });
    for (const f of ['has_image', 'has_cv'] as const)
        if (f in entry && typeof entry[f] !== 'boolean')
            errors.push({ field: f, message: 'must be boolean' });
    for (const f of ['screenshot_width', 'screenshot_height'] as const) {
        const v = entry[f];
        if (v !== undefined && v !== null && !Number.isInteger(v))
            errors.push({ field: f, message: 'must be integer or null' });
    }
    if (entry['type'] !== 'screen' && entry['type'] !== 'element')
        errors.push({ field: 'type', message: `must be "screen" or "element", got "${entry['type']}"` });
    return errors;
}

export function validateEntry(entry: unknown): ValidatedEntry {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
        return { _validation_errors: [{ field: '(root)', message: 'entry must be an object' }] };
    const rec = entry as Record<string, unknown>;
    const required = rec['type'] === 'element'
        ? [...COMMON, 'element_name'] as const
        : COMMON;
    const errors = [...checkRequired(rec, required), ...checkTypes(rec)];
    return errors.length ? { ...rec, _validation_errors: errors } : rec as ValidatedEntry;
}

export function isValid(entry: ValidatedEntry): boolean {
    return !entry._validation_errors?.length;
}
