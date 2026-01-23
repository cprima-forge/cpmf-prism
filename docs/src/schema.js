/**
 * Schema Version Handling for rpax prism
 * Centralizes all uisor v0.1.1 field mappings and data extraction
 */

import { createLogger } from './logger.js';

const log = createLogger('schema');

// Current supported schema version
export const SCHEMA_VERSION = 'v0.1.2';

/**
 * Field name mappings for uisor v0.1.2
 */
export const FIELDS = {
  screen: {
    name: 'screen_name',
    appName: 'app_name',
    appVersion: 'app_version',
    url: 'url',
    status: 'status',  // v0.1.1: was 'url_status', now 'status'
    selector: 'selector',
    declaredVariables: 'declared_variables',
    reference: 'reference',
    parentRef: 'parent_ref',
    path: 'path',
    version: 'version',
    // v0.1.2: screenshot fields
    screenshot: 'screenshot',
    screenshotWidth: 'screenshot_width',
    screenshotHeight: 'screenshot_height'
  },
  element: {
    name: 'element_name',
    appName: 'app_name',
    appVersion: 'app_version',
    screenName: 'screen_name',
    parentPath: 'parent_path',
    searchSteps: 'search_steps',
    elementType: 'element_type',
    activityType: 'activity_type',
    visibility: 'visibility',
    waitForReady: 'wait_for_ready',
    scopeSelector: 'scope_selector',
    fullSelector: 'full_selector',
    fuzzySelector: 'fuzzy_selector',
    hasImage: 'has_image',
    hasCv: 'has_cv',
    cvType: 'cv_type',
    declaredVariables: 'declared_variables',
    scopeVariables: 'scope_variables',
    selectorVariables: 'selector_variables',
    reference: 'reference',
    parentRef: 'parent_ref',
    path: 'path',
    version: 'version',
    // v0.1.2: screenshot fields
    screenshot: 'screenshot',
    screenshotWidth: 'screenshot_width',
    screenshotHeight: 'screenshot_height'
  }
};

/**
 * Get display name for a screen entry
 * @param {Object} screen - Screen entry from uisor data
 * @returns {string} Display name
 */
export function getScreenName(screen) {
  return screen?.[FIELDS.screen.name] || 'Unnamed Screen';
}

/**
 * Get display name for an element entry
 * @param {Object} element - Element entry from uisor data
 * @returns {string} Display name
 */
export function getElementName(element) {
  return element?.[FIELDS.element.name] || 'Unnamed Element';
}

/**
 * Get display name for any entry (screen or element)
 * @param {Object} entry - Entry from uisor data
 * @returns {string} Display name
 */
export function getEntryName(entry) {
  if (!entry) return 'Unknown';
  if (entry.type === 'screen') return getScreenName(entry);
  if (entry.type === 'element') return getElementName(entry);
  return entry.name || 'Unknown';
}

/**
 * Extract variable name from v0.1.1 variable object
 * v0.1.1 format: {name: "varName", default: "value"}
 * @param {Object} variable - Variable object
 * @returns {string} Variable name
 */
export function getVariableName(variable) {
  if (!variable) return '';
  if (typeof variable === 'object' && variable.name) {
    return variable.name;
  }
  // Fallback for unexpected format
  return String(variable);
}

/**
 * Extract variable default value from v0.1.1 variable object
 * @param {Object} variable - Variable object
 * @returns {string|null} Default value or null
 */
export function getVariableDefault(variable) {
  if (!variable || typeof variable !== 'object') return null;
  return variable.default || null;
}

/**
 * Get all variable names from an entry as string array
 * @param {Object} entry - Screen or element entry
 * @returns {string[]} Array of variable names
 */
export function getVariableNames(entry) {
  if (!entry) return [];

  const vars = [];

  // Collect from all variable fields
  const variableFields = [
    entry[FIELDS.screen.declaredVariables],
    entry[FIELDS.element.declaredVariables],
    entry[FIELDS.element.scopeVariables],
    entry[FIELDS.element.selectorVariables]
  ];

  for (const field of variableFields) {
    if (Array.isArray(field)) {
      for (const v of field) {
        const name = getVariableName(v);
        if (name) vars.push(name);
      }
    }
  }

  return vars;
}

/**
 * Get variables with metadata from an entry
 * @param {Object} entry - Screen or element entry
 * @returns {Array<{name: string, default: string|null, source: string}>}
 */
export function getVariablesWithMetadata(entry) {
  if (!entry) return [];

  const vars = [];

  const sources = [
    { field: FIELDS.screen.declaredVariables, source: 'declared' },
    { field: FIELDS.element.declaredVariables, source: 'declared' },
    { field: FIELDS.element.scopeVariables, source: 'scope' },
    { field: FIELDS.element.selectorVariables, source: 'selector' }
  ];

  for (const { field, source } of sources) {
    const arr = entry[field];
    if (Array.isArray(arr)) {
      for (const v of arr) {
        vars.push({
          name: getVariableName(v),
          default: getVariableDefault(v),
          source
        });
      }
    }
  }

  return vars;
}

/**
 * Check if entry has any variables
 * @param {Object} entry - Screen or element entry
 * @returns {boolean}
 */
export function hasVariables(entry) {
  return getVariableNames(entry).length > 0;
}

/**
 * Validate schema version
 * @param {string} version - Version string from manifest
 * @returns {boolean}
 */
export function isValidSchemaVersion(version) {
  if (!version) return false;
  return /^v\d+\.\d+\.\d+$/.test(version);
}

/**
 * Check if schema version is supported
 * @param {string} version - Version string
 * @returns {boolean}
 */
export function isSchemaSupported(version) {
  // Currently only v0.1.1 is fully supported
  return version === SCHEMA_VERSION;
}
