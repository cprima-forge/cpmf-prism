/**
 * IndexedDB Storage Layer for rpax prism
 * Two-level schema: imports -> datasets
 */

import { createLogger } from './logger.js';
import { getVariableName, FIELDS } from './schema.js';

const log = createLogger('storage');

const DB_NAME = 'rpax-prism';
const DB_VERSION = 2;  // v2: added screenshots store

let db = null;

/**
 * Initialize the database
 */
export async function initDB() {
  log.info('Initializing IndexedDB...');
  log.time('initDB');

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      log.error('Failed to open database', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      log.info('Database opened successfully', { name: DB_NAME, version: DB_VERSION });
      log.timeEnd('initDB');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      log.info('Database upgrade needed', { oldVersion: event.oldVersion, newVersion: event.newVersion });
      const database = event.target.result;

      // Create imports store
      if (!database.objectStoreNames.contains('imports')) {
        const importsStore = database.createObjectStore('imports', { keyPath: 'importId' });
        importsStore.createIndex('createdAt', 'createdAt', { unique: false });
        log.debug('Created imports store');
      }

      // Create datasets store
      if (!database.objectStoreNames.contains('datasets')) {
        const datasetsStore = database.createObjectStore('datasets', { keyPath: 'datasetId' });
        datasetsStore.createIndex('importId', 'importId', { unique: false });
        datasetsStore.createIndex('type', 'type', { unique: false });
        log.debug('Created datasets store');
      }

      // Create screenshots store (v2)
      if (!database.objectStoreNames.contains('screenshots')) {
        const screenshotsStore = database.createObjectStore('screenshots', { keyPath: 'screenshotId' });
        screenshotsStore.createIndex('importId', 'importId', { unique: false });
        log.debug('Created screenshots store');
      }
    };
  });
}

/**
 * Generate a UUID
 */
function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
}

// ============ IMPORTS ============

/**
 * Create a new import record
 */
export async function createImport(manifest, label = null) {
  log.info('Creating import record', { source: manifest.source, label });

  const importRecord = {
    importId: generateId(),
    createdAt: new Date().toISOString(),
    packFormatVersion: manifest.version,
    source: manifest.source || 'unknown',
    label: label || `Import ${new Date().toLocaleDateString()}`
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['imports'], 'readwrite');
    const store = transaction.objectStore('imports');
    const request = store.add(importRecord);

    request.onsuccess = () => {
      log.info('Import created', { importId: importRecord.importId });
      resolve(importRecord);
    };

    request.onerror = (event) => {
      log.error('Failed to create import', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Get an import by ID
 */
export async function getImport(importId) {
  log.debug('Getting import', { importId });

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['imports'], 'readonly');
    const store = transaction.objectStore('imports');
    const request = store.get(importId);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = (event) => {
      log.error('Failed to get import', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * List all imports
 */
export async function listImports() {
  log.debug('Listing all imports');

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['imports'], 'readonly');
    const store = transaction.objectStore('imports');
    const index = store.index('createdAt');
    const request = index.getAll();

    request.onsuccess = () => {
      const imports = request.result.reverse(); // Most recent first
      log.debug('Found imports', { count: imports.length });
      resolve(imports);
    };

    request.onerror = (event) => {
      log.error('Failed to list imports', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Update import label
 */
export async function updateImportLabel(importId, label) {
  log.info('Updating import label', { importId, label });

  const importRecord = await getImport(importId);
  if (!importRecord) {
    throw new Error(`Import not found: ${importId}`);
  }

  importRecord.label = label;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['imports'], 'readwrite');
    const store = transaction.objectStore('imports');
    const request = store.put(importRecord);

    request.onsuccess = () => {
      log.info('Import label updated');
      resolve(importRecord);
    };

    request.onerror = (event) => {
      log.error('Failed to update import label', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Delete an import and all its datasets and screenshots
 */
export async function deleteImport(importId) {
  log.info('Deleting import', { importId });

  // First delete all datasets
  const datasets = await listDatasetsByImport(importId);
  log.debug('Deleting associated datasets', { count: datasets.length });

  // Delete screenshots
  await deleteScreenshotsByImport(importId);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['imports', 'datasets'], 'readwrite');
    const importsStore = transaction.objectStore('imports');
    const datasetsStore = transaction.objectStore('datasets');

    // Delete datasets
    for (const dataset of datasets) {
      datasetsStore.delete(dataset.datasetId);
    }

    // Delete import
    const request = importsStore.delete(importId);

    transaction.oncomplete = () => {
      log.info('Import and datasets deleted', { importId, datasetsDeleted: datasets.length });
      resolve();
    };

    transaction.onerror = (event) => {
      log.error('Failed to delete import', event.target.error);
      reject(event.target.error);
    };
  });
}

// ============ DATASETS ============

/**
 * Save a dataset
 */
export async function saveDataset(importId, exportEntry, rawJson, payload) {
  const exportId = exportEntry.id || exportEntry.type;
  const datasetId = `${importId}:${exportId}`;

  log.info('Saving dataset', { datasetId, type: exportEntry.type, path: exportEntry.path });
  log.time(`saveDataset:${datasetId}`);

  // Build search index
  const index = buildSearchIndex(payload, exportEntry.type);
  log.debug('Built search index', {
    elementCount: index.elementCount,
    searchIndexSize: index.searchIndex?.length
  });

  const datasetRecord = {
    datasetId,
    importId,
    type: exportEntry.type,
    exportId: exportEntry.id || null,
    path: exportEntry.path,
    contentType: 'application/json',
    rawJson,
    payload,
    index
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['datasets'], 'readwrite');
    const store = transaction.objectStore('datasets');
    const request = store.put(datasetRecord);

    request.onsuccess = () => {
      log.info('Dataset saved', { datasetId });
      log.timeEnd(`saveDataset:${datasetId}`);
      resolve(datasetRecord);
    };

    request.onerror = (event) => {
      log.error('Failed to save dataset', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Normalize variables to string array using schema helper
 */
function normalizeVariables(variables) {
  if (!variables || !Array.isArray(variables)) return [];
  return variables.map(v => getVariableName(v));
}

/**
 * Build search index from payload
 * Data structure: { project, library, entries[] } where entries are flat with parent_ref
 */
function buildSearchIndex(payload, type) {
  const index = {
    elementCount: 0,
    appCount: 0,
    screenCount: 0,
    versionCount: 0,
    searchIndex: []
  };

  if (type !== 'uisor' || !payload) {
    return index;
  }

  log.debug('Building search index for uisor payload');

  // Track unique apps and versions from entry paths
  const apps = new Set();
  const versions = new Set();

  // Process flat entries array
  if (payload.entries) {
    for (const entry of payload.entries) {
      // Extract app/version from path (format: "AppName/Version/ScreenName")
      if (entry.path) {
        const pathParts = entry.path.split('/');
        if (pathParts.length >= 1) apps.add(pathParts[0]);
        if (pathParts.length >= 2) versions.add(`${pathParts[0]}/${pathParts[1]}`);
      }

      if (entry.type === 'screen') {
        index.screenCount++;
        const variables = normalizeVariables(entry[FIELDS.screen.declaredVariables]);
        index.searchIndex.push({
          type: 'screen',
          name: entry[FIELDS.screen.name],
          reference: entry[FIELDS.screen.reference],
          url: entry[FIELDS.screen.url],
          selector: entry[FIELDS.screen.selector],
          variables,
          path: entry[FIELDS.screen.path]
        });
      } else if (entry.type === 'element') {
        index.elementCount++;
        // Only count declared_variables as actual variables for filtering
        // scope_variables and selector_variables are expressions, not variables
        const variables = normalizeVariables(entry[FIELDS.element.declaredVariables]);
        index.searchIndex.push({
          type: 'element',
          name: entry[FIELDS.element.name],
          reference: entry[FIELDS.element.reference],
          elementType: entry[FIELDS.element.elementType],
          hasImage: entry[FIELDS.element.hasImage],
          hasCv: entry[FIELDS.element.hasCv],
          fullSelector: entry[FIELDS.element.fullSelector],
          scopeSelector: entry[FIELDS.element.scopeSelector],
          variables
        });
      }
    }
  }

  index.appCount = apps.size;
  index.versionCount = versions.size;

  log.debug('Search index built', {
    apps: index.appCount,
    versions: index.versionCount,
    screens: index.screenCount,
    elements: index.elementCount,
    totalIndexed: index.searchIndex.length
  });

  return index;
}

/**
 * Get a dataset by ID
 */
export async function getDataset(datasetId) {
  log.debug('Getting dataset', { datasetId });

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['datasets'], 'readonly');
    const store = transaction.objectStore('datasets');
    const request = store.get(datasetId);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = (event) => {
      log.error('Failed to get dataset', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * List datasets by import ID
 */
export async function listDatasetsByImport(importId) {
  log.debug('Listing datasets by import', { importId });

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['datasets'], 'readonly');
    const store = transaction.objectStore('datasets');
    const index = store.index('importId');
    const request = index.getAll(importId);

    request.onsuccess = () => {
      log.debug('Found datasets', { importId, count: request.result.length });
      resolve(request.result);
    };

    request.onerror = (event) => {
      log.error('Failed to list datasets', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * List datasets by type
 */
export async function listDatasetsByType(type) {
  log.debug('Listing datasets by type', { type });

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['datasets'], 'readonly');
    const store = transaction.objectStore('datasets');
    const index = store.index('type');
    const request = index.getAll(type);

    request.onsuccess = () => {
      log.debug('Found datasets', { type, count: request.result.length });
      resolve(request.result);
    };

    request.onerror = (event) => {
      log.error('Failed to list datasets by type', event.target.error);
      reject(event.target.error);
    };
  });
}

// ============ CLEANUP ============

/**
 * Clear all data
 */
export async function clearAll() {
  log.warn('Clearing all data!');

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['imports', 'datasets'], 'readwrite');

    transaction.objectStore('imports').clear();
    transaction.objectStore('datasets').clear();

    transaction.oncomplete = () => {
      log.info('All data cleared');
      resolve();
    };

    transaction.onerror = (event) => {
      log.error('Failed to clear data', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Get database statistics
 */
export async function getStats() {
  const imports = await listImports();
  let totalDatasets = 0;
  let totalElements = 0;

  for (const imp of imports) {
    const datasets = await listDatasetsByImport(imp.importId);
    totalDatasets += datasets.length;
    for (const ds of datasets) {
      totalElements += ds.index?.elementCount || 0;
    }
  }

  return {
    imports: imports.length,
    datasets: totalDatasets,
    elements: totalElements
  };
}

// ============ SCREENSHOTS ============

/**
 * Save a screenshot
 * @param {string} importId - Import ID
 * @param {string} filename - Screenshot filename (e.g., "abc123.png")
 * @param {Blob} blob - Image blob data
 */
export async function saveScreenshot(importId, filename, blob) {
  const screenshotId = `${importId}:${filename}`;
  log.debug('Saving screenshot', { screenshotId, size: blob.size });

  const record = {
    screenshotId,
    importId,
    filename,
    blob,
    contentType: blob.type
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['screenshots'], 'readwrite');
    const store = transaction.objectStore('screenshots');
    const request = store.put(record);

    request.onsuccess = () => {
      resolve(record);
    };

    request.onerror = (event) => {
      log.error('Failed to save screenshot', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Get a screenshot by import ID and filename
 * @param {string} importId - Import ID
 * @param {string} filename - Screenshot filename
 * @returns {Promise<Blob|null>}
 */
export async function getScreenshot(importId, filename) {
  const screenshotId = `${importId}:${filename}`;
  log.debug('Getting screenshot', { screenshotId });

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['screenshots'], 'readonly');
    const store = transaction.objectStore('screenshots');
    const request = store.get(screenshotId);

    request.onsuccess = () => {
      const record = request.result;
      resolve(record ? record.blob : null);
    };

    request.onerror = (event) => {
      log.error('Failed to get screenshot', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Delete all screenshots for an import
 * @param {string} importId - Import ID
 */
export async function deleteScreenshotsByImport(importId) {
  log.debug('Deleting screenshots for import', { importId });

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['screenshots'], 'readwrite');
    const store = transaction.objectStore('screenshots');
    const index = store.index('importId');
    const request = index.openCursor(IDBKeyRange.only(importId));

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    transaction.oncomplete = () => {
      log.debug('Screenshots deleted for import', { importId });
      resolve();
    };

    transaction.onerror = (event) => {
      log.error('Failed to delete screenshots', event.target.error);
      reject(event.target.error);
    };
  });
}
