/**
 * Import Manager & Dataset Chooser
 * Sidebar UI for managing imports and selecting datasets
 */

import { createLogger } from '../logger.js';
import {
  listImports,
  listDatasetsByImport,
  deleteImport,
  updateImportLabel
} from '../storage.js';
import {
  getState,
  setActiveImport,
  setSelectedDataset,
  getSelectedDataset,
  openTab,
  removeImportTabs,
  subscribe
} from '../state.js';

const log = createLogger('import-chooser');

let importListEl = null;
let datasetListEl = null;

/**
 * Initialize import chooser
 */
export function initImportChooser() {
  log.info('Initializing import chooser');

  importListEl = document.getElementById('import-list');
  datasetListEl = document.getElementById('dataset-list');

  if (!importListEl || !datasetListEl) {
    log.error('Import/dataset list elements not found');
    return;
  }

  // Subscribe to state changes
  subscribe((changeType) => {
    if (['importActivated', 'datasetSelected', 'stateCleared'].includes(changeType)) {
      refresh();
    }
  });

  // Initial render
  refresh();
}

/**
 * Refresh the import and dataset lists
 */
export async function refresh() {
  log.debug('Refreshing import chooser');

  try {
    await renderImportList();
    await renderDatasetList();
  } catch (e) {
    log.error('Refresh failed', { error: e.message });
  }
}

/**
 * Render the import list
 */
async function renderImportList() {
  const imports = await listImports();
  const state = getState();

  log.debug('Rendering import list', { count: imports.length, activeId: state.activeImportId });

  if (imports.length === 0) {
    importListEl.innerHTML = '<li class="empty-state">No imports yet</li>';
    return;
  }

  importListEl.innerHTML = imports.map(imp => `
    <li class="${imp.importId === state.activeImportId ? 'active' : ''}"
        data-import-id="${imp.importId}">
      <span class="import-label" title="${imp.importId}">${escapeHtml(imp.label)}</span>
      <button class="btn-icon delete-import" data-import-id="${imp.importId}" title="Delete">
        &times;
      </button>
    </li>
  `).join('');

  // Attach event listeners
  for (const li of importListEl.querySelectorAll('li[data-import-id]')) {
    const importId = li.dataset.importId;

    // Click to select
    li.addEventListener('click', (e) => {
      if (!e.target.classList.contains('delete-import')) {
        log.info('Import selected', { importId });
        setActiveImport(importId);
      }
    });

    // Double-click to rename
    const label = li.querySelector('.import-label');
    label.addEventListener('dblclick', () => {
      startRename(importId, label);
    });

    // Delete button
    const deleteBtn = li.querySelector('.delete-import');
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Delete this import and all its datasets?')) {
        log.info('Deleting import', { importId });
        await deleteImport(importId);
        removeImportTabs(importId);
        refresh();
      }
    });
  }
}

/**
 * Start inline rename
 */
function startRename(importId, labelEl) {
  log.debug('Starting rename', { importId });

  const currentLabel = labelEl.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentLabel;
  input.className = 'rename-input';

  labelEl.replaceWith(input);
  input.focus();
  input.select();

  const finishRename = async () => {
    const newLabel = input.value.trim() || currentLabel;
    if (newLabel !== currentLabel) {
      await updateImportLabel(importId, newLabel);
    }
    refresh();
  };

  input.addEventListener('blur', finishRename);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      input.blur();
    } else if (e.key === 'Escape') {
      input.value = currentLabel;
      input.blur();
    }
  });
}

/**
 * Render the dataset list for the active import
 */
async function renderDatasetList() {
  const state = getState();

  if (!state.activeImportId) {
    datasetListEl.innerHTML = '<li class="empty-state">Select an import</li>';
    return;
  }

  const datasets = await listDatasetsByImport(state.activeImportId);
  const selectedId = getSelectedDataset(state.activeImportId);

  log.debug('Rendering dataset list', {
    importId: state.activeImportId,
    count: datasets.length,
    selectedId
  });

  if (datasets.length === 0) {
    datasetListEl.innerHTML = '<li class="empty-state">No datasets</li>';
    return;
  }

  datasetListEl.innerHTML = datasets.map(ds => `
    <li class="${ds.datasetId === selectedId ? 'active' : ''}"
        data-dataset-id="${ds.datasetId}">
      <span class="type-badge">${escapeHtml(ds.type)}</span>
      <span class="dataset-name">${escapeHtml(ds.exportId || ds.type)}</span>
    </li>
  `).join('');

  // Attach event listeners
  for (const li of datasetListEl.querySelectorAll('li[data-dataset-id]')) {
    li.addEventListener('click', () => {
      const datasetId = li.dataset.datasetId;
      const dataset = datasets.find(d => d.datasetId === datasetId);

      log.info('Dataset clicked', { datasetId });

      setSelectedDataset(state.activeImportId, datasetId);
      openTab(datasetId, dataset.type, dataset.exportId || dataset.type);
    });
  }
}

/**
 * Handle new import - auto-select first uisor dataset
 */
export async function handleNewImport(importResult) {
  log.info('Handling new import', {
    importId: importResult.import.importId,
    datasetCount: importResult.datasets.length
  });

  // Set as active import
  setActiveImport(importResult.import.importId);

  // Find and select first uisor dataset
  const uisorDataset = importResult.datasets.find(d => d.type === 'uisor');
  if (uisorDataset) {
    log.info('Auto-selecting uisor dataset', { datasetId: uisorDataset.datasetId });
    setSelectedDataset(importResult.import.importId, uisorDataset.datasetId);
    openTab(uisorDataset.datasetId, 'uisor', uisorDataset.exportId || 'uisor');
  } else if (importResult.datasets.length > 0) {
    // Fall back to first dataset
    const first = importResult.datasets[0];
    log.info('No uisor dataset, selecting first', { datasetId: first.datasetId });
    setSelectedDataset(importResult.import.importId, first.datasetId);
    openTab(first.datasetId, first.type, first.exportId || first.type);
  }

  await refresh();
}

/**
 * Escape HTML
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
