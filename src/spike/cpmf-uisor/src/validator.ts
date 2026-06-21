// Schema boundary validation for uisor v0.1.2 entries.
// Checks required fields per type without external dependencies.
// Invalid entries are passed through with _validation_errors[] populated.

export interface ValidationError {
    field: string;
    message: string;
}

export interface ValidatedEntry {
    _validation_errors?: ValidationError[];
    [key: string]: unknown;
}

const COMMON_REQUIRED = ['type', 'reference', 'app_name', 'app_version', 'screen_name'] as const;
const SCREEN_REQUIRED = [...COMMON_REQUIRED] as const;
const ELEMENT_REQUIRED = [...COMMON_REQUIRED, 'element_name'] as const;

function checkRequired(entry: Record<string, unknown>, fields: readonly string[]): ValidationError[] {
    return fields
        .filter(f => entry[f] === undefined || entry[f] === null || entry[f] === '')
        .map(f => ({ field: f, message: `required field "${f}" missing or empty` }));
}

function checkTypes(entry: Record<string, unknown>): ValidationError[] {
    const errors: ValidationError[] = [];

    // reference must be a non-empty string
    if (typeof entry['reference'] !== 'string') {
        errors.push({ field: 'reference', message: 'must be string' });
    }

    // has_image / has_cv must be boolean if present
    for (const f of ['has_image', 'has_cv'] as const) {
        if (f in entry && typeof entry[f] !== 'boolean') {
            errors.push({ field: f, message: 'must be boolean' });
        }
    }

    // screenshot_width / screenshot_height must be integer or null if present
    for (const f of ['screenshot_width', 'screenshot_height'] as const) {
        const v = entry[f];
        if (v !== undefined && v !== null && (!Number.isInteger(v))) {
            errors.push({ field: f, message: 'must be integer or null' });
        }
    }

    // type must be 'screen' or 'element'
    if (entry['type'] !== 'screen' && entry['type'] !== 'element') {
        errors.push({ field: 'type', message: `must be "screen" or "element", got "${entry['type']}"` });
    }

    return errors;
}

export function validateEntry(entry: unknown): ValidatedEntry {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        return {
            _validation_errors: [{ field: '(root)', message: 'entry must be an object' }],
        } as ValidatedEntry;
    }

    const rec = entry as Record<string, unknown>;
    const type = rec['type'];

    const requiredErrors =
        type === 'screen'  ? checkRequired(rec, SCREEN_REQUIRED) :
        type === 'element' ? checkRequired(rec, ELEMENT_REQUIRED) :
        [{ field: 'type', message: `unknown type "${type}"` }];

    const typeErrors = checkTypes(rec);
    const errors = [...requiredErrors, ...typeErrors];

    if (errors.length === 0) {
        return rec as ValidatedEntry;
    }

    return { ...rec, _validation_errors: errors } as ValidatedEntry;
}

export function isValid(entry: ValidatedEntry): boolean {
    return !entry._validation_errors || entry._validation_errors.length === 0;
}
