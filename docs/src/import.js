/**
 * File Import Module for rpax prism
 * Handles ZIP pack parsing and manifest validation
 */

import { createLogger } from './logger.js';
import { createImport, saveDataset, saveScreenshot } from './storage.js';

const log = createLogger('import');

// Expected manifest filename
const MANIFEST_FILENAME = 'prism.manifest.json';

// Supported format
const SUPPORTED_FORMAT = 'cpmf-prism-pack';

/**
 * Import a ZIP pack file
 * @param {File} file - The ZIP file
 * @returns {Promise<{import: Object, datasets: Array}>}
 */
export async function importPack(file) {
  log.info('Starting pack import', { filename: file.name, size: file.size });
  log.time('importPack');

  try {
    // Load JSZip
    log.debug('Loading JSZip library');
    const JSZip = window.JSZip;
    if (!JSZip) {
      throw new Error('JSZip library not loaded. Ensure vendor/jszip.min.js is included.');
    }

    // Read ZIP file
    log.debug('Reading ZIP file');
    log.time('readZip');
    const zip = await JSZip.loadAsync(file);
    log.timeEnd('readZip');

    // List files in ZIP
    const fileList = Object.keys(zip.files);
    log.debug('ZIP contents', { fileCount: fileList.length, files: fileList });

    // Find and read manifest
    log.debug('Looking for manifest', { expected: MANIFEST_FILENAME });
    const manifestFile = zip.file(MANIFEST_FILENAME);
    if (!manifestFile) {
      // Also try without path prefix
      const altManifest = fileList.find(f => f.endsWith(MANIFEST_FILENAME));
      if (altManifest) {
        log.warn('Found manifest at alternate path', { path: altManifest });
      }
      throw new Error(`Manifest not found. Expected: ${MANIFEST_FILENAME}. Files in ZIP: ${fileList.join(', ')}`);
    }

    log.debug('Reading manifest');
    const manifestText = await manifestFile.async('string');
    log.debug('Manifest content (raw)', { length: manifestText.length, preview: manifestText.slice(0, 200) });

    // Parse manifest
    let manifest;
    try {
      manifest = JSON.parse(manifestText);
      log.info('Manifest parsed', manifest);
    } catch (e) {
      log.error('Invalid manifest JSON', { error: e.message });
      throw new Error(`Invalid manifest JSON: ${e.message}`);
    }

    // Validate manifest
    validateManifest(manifest);

    // Create import record
    const importRecord = await createImport(manifest);
    log.info('Import record created', { importId: importRecord.importId });

    // Process exports
    const datasets = [];
    log.group('Processing exports');

    for (const exportEntry of manifest.exports) {
      log.info('Processing export', exportEntry);

      try {
        const dataset = await processExport(zip, importRecord.importId, exportEntry);
        datasets.push(dataset);
      } catch (e) {
        log.error('Failed to process export', { export: exportEntry, error: e.message });
        // Continue with other exports
      }
    }

    log.groupEnd();

    // Extract and save screenshots
    log.group('Processing screenshots');
    const screenshotCount = await processScreenshots(zip, importRecord.importId);
    log.groupEnd();

    log.timeEnd('importPack');

    log.info('Import complete', {
      importId: importRecord.importId,
      datasetsCreated: datasets.length,
      totalExports: manifest.exports.length,
      screenshots: screenshotCount
    });

    return {
      import: importRecord,
      datasets,
      screenshotCount
    };

  } catch (error) {
    log.error('Import failed', { error: error.message, stack: error.stack });
    throw error;
  }
}

/**
 * Validate manifest structure
 */
function validateManifest(manifest) {
  log.debug('Validating manifest');

  // Check format
  if (manifest.format !== SUPPORTED_FORMAT) {
    throw new Error(`Unsupported format: ${manifest.format}. Expected: ${SUPPORTED_FORMAT}`);
  }

  // Check version (support v0.x.x or 1.x semver formats)
  const versionPattern = /^v?\d+\.\d+(\.\d+)?$/;
  if (!manifest.version || !versionPattern.test(manifest.version)) {
    throw new Error(`Unsupported version: ${manifest.version}. Expected: semver format (e.g., v0.1.0 or 1.0)`);
  }

  // Check exports
  if (!Array.isArray(manifest.exports) || manifest.exports.length === 0) {
    throw new Error('Manifest must have at least one export');
  }

  for (const exp of manifest.exports) {
    if (!exp.type) {
      throw new Error('Export missing required field: type');
    }
    if (!exp.path) {
      throw new Error('Export missing required field: path');
    }
    // Validate path format (POSIX, no leading ./)
    if (exp.path.startsWith('./') || exp.path.startsWith('.\\')) {
      log.warn('Path has leading ./', { path: exp.path });
    }
    if (exp.path.includes('\\')) {
      log.warn('Path contains backslashes', { path: exp.path });
    }
  }

  log.debug('Manifest validation passed');
}

/**
 * Process a single export from the ZIP
 */
async function processExport(zip, importId, exportEntry) {
  log.debug('Reading export file', { path: exportEntry.path });
  log.time(`readExport:${exportEntry.path}`);

  // Find file in ZIP
  let dataFile = zip.file(exportEntry.path);

  // Try alternate path formats if not found
  if (!dataFile) {
    log.warn('Export file not found at exact path, searching...', { path: exportEntry.path });

    // Try with/without leading slash
    const altPaths = [
      exportEntry.path,
      '/' + exportEntry.path,
      exportEntry.path.replace(/^\//, '')
    ];

    for (const altPath of altPaths) {
      dataFile = zip.file(altPath);
      if (dataFile) {
        log.info('Found file at alternate path', { original: exportEntry.path, found: altPath });
        break;
      }
    }

    if (!dataFile) {
      throw new Error(`Export file not found: ${exportEntry.path}`);
    }
  }

  // Read file content
  const rawJson = await dataFile.async('string');
  log.timeEnd(`readExport:${exportEntry.path}`);
  log.debug('Export file read', { path: exportEntry.path, size: rawJson.length });

  // Parse JSON
  let payload;
  try {
    payload = JSON.parse(rawJson);
    log.debug('Export parsed successfully');
  } catch (e) {
    log.error('Invalid export JSON', { path: exportEntry.path, error: e.message });
    throw new Error(`Invalid JSON in ${exportEntry.path}: ${e.message}`);
  }

  // Validate based on type
  validateExportPayload(exportEntry.type, payload);

  // Save to database
  const dataset = await saveDataset(importId, exportEntry, rawJson, payload);

  return dataset;
}

/**
 * Validate export payload based on type
 */
function validateExportPayload(type, payload) {
  log.debug('Validating export payload', { type });

  switch (type) {
    case 'uisor':
      if (!payload.project) {
        log.warn('uisor payload missing project field');
      }
      if (!payload.entries || !Array.isArray(payload.entries)) {
        throw new Error('uisor payload must have entries array');
      }
      log.debug('uisor validation passed', {
        projectName: payload.project?.name,
        entryCount: payload.entries.length
      });
      break;

    default:
      log.debug('No specific validation for type', { type });
  }
}

/**
 * Process screenshots from ZIP
 * @param {JSZip} zip - ZIP file
 * @param {string} importId - Import ID
 * @returns {Promise<number>} Number of screenshots processed
 */
async function processScreenshots(zip, importId) {
  const screenshotFiles = Object.keys(zip.files).filter(path =>
    path.startsWith('screenshots/') && !zip.files[path].dir
  );

  log.info('Found screenshots', { count: screenshotFiles.length });

  if (screenshotFiles.length === 0) {
    return 0;
  }

  let count = 0;
  for (const path of screenshotFiles) {
    try {
      const filename = path.split('/').pop();
      if (!filename) continue;

      const file = zip.file(path);
      if (!file) continue;

      // Read as blob
      const blob = await file.async('blob');

      // Determine content type from extension
      const ext = filename.split('.').pop()?.toLowerCase();
      const contentType = ext === 'png' ? 'image/png' :
                         ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                         'image/png';

      // Create properly typed blob
      const typedBlob = new Blob([blob], { type: contentType });

      await saveScreenshot(importId, filename, typedBlob);
      count++;

      if (count % 20 === 0) {
        log.debug('Screenshot progress', { processed: count, total: screenshotFiles.length });
      }
    } catch (e) {
      log.warn('Failed to save screenshot', { path, error: e.message });
    }
  }

  log.info('Screenshots processed', { count });
  return count;
}

/**
 * Setup drop zone event handlers
 */
export function setupDropZone(dropZone, fileInput, onImport) {
  log.info('Setting up drop zone');

  // Prevent default drag behaviors
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  // Highlight drop zone
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.add('active');
      log.debug('Drop zone active');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.remove('active');
    });
  });

  // Handle drop
  dropZone.addEventListener('drop', async (e) => {
    log.info('File dropped');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await handleFile(files[0], onImport);
    }
  });

  // Handle click
  dropZone.addEventListener('click', () => {
    log.debug('Drop zone clicked');
    fileInput.click();
  });

  // Handle file input change
  fileInput.addEventListener('change', async (e) => {
    log.info('File selected via input');
    if (e.target.files.length > 0) {
      await handleFile(e.target.files[0], onImport);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  });
}

/**
 * Handle file selection
 */
async function handleFile(file, onImport) {
  log.info('Handling file', { name: file.name, type: file.type, size: file.size });

  // Validate file type
  if (!file.name.endsWith('.zip')) {
    log.warn('Invalid file type', { name: file.name });
    alert('Please select a .zip file');
    return;
  }

  try {
    const result = await importPack(file);
    onImport(result);
  } catch (error) {
    log.error('Import error', { message: error.message });
    alert(`Import failed: ${error.message}`);
  }
}
