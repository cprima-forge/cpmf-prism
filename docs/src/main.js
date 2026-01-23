/**
 * Main Entry Point for rpax prism
 * Initializes all modules and orchestrates the application
 */

import { createLogger, setLogLevel } from './logger.js';
import { initDB, clearAll, getStats, listImports } from './storage.js';
import { initState, clearState, subscribe, getActiveTab } from './state.js';
import { initTheme } from './theme.js';
import { importPack, setupDropZone } from './import.js';
import { initImportChooser, handleNewImport, refresh as refreshImportChooser } from './views/import-chooser.js';
import { initInventoryView, loadDataset } from './views/inventory/index.js';
import { setSearchIndex } from './views/inventory/search.js';
import { setImportId } from './views/inventory/detail.js';
import { setImportId as setHierarchyImportId } from './views/inventory/hierarchy.js';

const log = createLogger('main');

// Enable debug logging for development
setLogLevel('DEBUG');

/**
 * Application entry point
 */
async function init() {
  log.info('=== rpax prism initializing ===');
  log.time('init');

  try {
    // Initialize storage
    log.info('Initializing storage...');
    await initDB();

    // Initialize state
    log.info('Initializing state...');
    initState();

    // Initialize theme
    log.info('Initializing theme...');
    initTheme();

    // Initialize UI components
    log.info('Initializing UI...');
    initImportChooser();
    initInventoryView();

    // Setup import drop zone
    setupImportUI();

    // Setup tab bar
    setupTabBar();

    // Setup delete all button
    setupDeleteAll();

    // Load initial data if available
    await loadInitialData();

    log.timeEnd('init');
    log.info('=== rpax prism ready ===');

    // Log stats
    const stats = await getStats();
    log.info('Database stats', stats);

  } catch (error) {
    log.error('Initialization failed', { error: error.message, stack: error.stack });
    showError(`Failed to initialize: ${error.message}`);
  }
}

/**
 * Setup import UI (button and drop zone)
 */
function setupImportUI() {
  const importBtn = document.getElementById('import-btn');
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  if (!dropZone || !fileInput) {
    log.warn('Drop zone elements not found');
    return;
  }

  // Import button shows drop zone
  importBtn?.addEventListener('click', () => {
    log.debug('Import button clicked');
    dropZone.classList.remove('hidden');
  });

  // Click outside drop zone content to close
  dropZone.addEventListener('click', (e) => {
    if (e.target === dropZone) {
      dropZone.classList.add('hidden');
    }
  });

  // Setup drop zone handlers
  setupDropZone(dropZone, fileInput, async (result) => {
    log.info('Import completed', { importId: result.import.importId });

    // Hide drop zone
    dropZone.classList.add('hidden');

    // Handle the new import (updates sidebar, opens tab)
    await handleNewImport(result);

    // If there's a uisor dataset, set its search index and import ID for screenshots
    const uisorDataset = result.datasets.find(d => d.type === 'uisor');
    if (uisorDataset?.index) {
      setSearchIndex(uisorDataset.index);
      setImportId(result.import.importId);
      setHierarchyImportId(result.import.importId);
    }
  });

  // Show drop zone if no imports exist
  checkShowDropZone();
}

/**
 * Check if drop zone should be shown (no imports)
 */
async function checkShowDropZone() {
  const imports = await listImports();
  if (imports.length === 0) {
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) {
      dropZone.classList.remove('hidden');
      log.info('No imports found, showing drop zone');
    }
  }
}

/**
 * Setup tab bar
 */
function setupTabBar() {
  const tabBar = document.getElementById('tab-bar');
  if (!tabBar) return;

  // Subscribe to state changes
  subscribe((changeType, data, state) => {
    if (['tabOpened', 'tabClosed', 'tabActivated', 'stateCleared'].includes(changeType)) {
      renderTabBar(state.openTabs);
    }
  });

  // Initial render
  const state = initState();
  renderTabBar(state.openTabs);
}

/**
 * Render tab bar
 */
function renderTabBar(tabs) {
  const tabBar = document.getElementById('tab-bar');
  if (!tabBar) return;

  if (tabs.length === 0) {
    tabBar.innerHTML = '<div class="empty-tabs">No datasets open</div>';
    return;
  }

  tabBar.innerHTML = tabs.map(tab => `
    <div class="tab ${tab.active ? 'active' : ''}" data-dataset-id="${escapeAttr(tab.datasetId)}">
      <span class="tab-label">${escapeHtml(tab.label)}</span>
      <span class="type-badge">${escapeHtml(tab.type)}</span>
      <button class="tab-close" data-dataset-id="${escapeAttr(tab.datasetId)}">&times;</button>
    </div>
  `).join('');

  // Attach event handlers
  tabBar.querySelectorAll('.tab').forEach(tabEl => {
    const datasetId = tabEl.dataset.datasetId;

    // Click to activate
    tabEl.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) {
        import('./state.js').then(({ setActiveTab }) => {
          setActiveTab(datasetId);
        });
      }
    });

    // Close button
    const closeBtn = tabEl.querySelector('.tab-close');
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      import('./state.js').then(({ closeTab }) => {
        closeTab(datasetId);
      });
    });
  });
}

/**
 * Setup delete all button
 */
function setupDeleteAll() {
  const deleteBtn = document.getElementById('delete-all');
  if (!deleteBtn) return;

  deleteBtn.addEventListener('click', async () => {
    if (!confirm('Delete ALL stored data? This cannot be undone.')) {
      return;
    }

    log.warn('User confirmed delete all');

    try {
      await clearAll();
      clearState();
      await refreshImportChooser();

      // Clear tree and detail views
      const treeContainer = document.getElementById('tree-container');
      if (treeContainer) {
        treeContainer.innerHTML = '<div class="empty-state"><p>No data</p></div>';
      }

      // Show drop zone
      const dropZone = document.getElementById('drop-zone');
      dropZone?.classList.remove('hidden');

      log.info('All data deleted');
    } catch (e) {
      log.error('Delete failed', { error: e.message });
      alert(`Delete failed: ${e.message}`);
    }
  });
}

/**
 * Load initial data from storage
 */
async function loadInitialData() {
  const activeTab = getActiveTab();
  if (activeTab) {
    log.info('Loading active tab dataset', { datasetId: activeTab.datasetId });

    try {
      const { getDataset } = await import('./storage.js');
      const dataset = await getDataset(activeTab.datasetId);

      if (dataset) {
        if (dataset.type === 'uisor') {
          await loadDataset(activeTab.datasetId);
          if (dataset.index) {
            setSearchIndex(dataset.index);
          }
          // Set import ID for screenshot loading (extract from datasetId format: importId:exportId)
          const importId = dataset.importId || activeTab.datasetId.split(':')[0];
          setImportId(importId);
          setHierarchyImportId(importId);
        }
      } else {
        log.warn('Active tab dataset not found in storage');
      }
    } catch (e) {
      log.error('Failed to load initial dataset', { error: e.message });
    }
  }

  // Refresh import chooser
  await refreshImportChooser();
}

/**
 * Show error in main content area
 */
function showError(message) {
  const content = document.querySelector('.content-area');
  if (content) {
    content.innerHTML = `
      <div class="empty-state" style="width: 100%; padding: 2rem;">
        <p style="color: var(--danger-text);">Error: ${escapeHtml(message)}</p>
        <button class="btn" onclick="location.reload()">Reload</button>
      </div>
    `;
  }
}

// Utility functions
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

// Start application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
