/**
 * Inventory View Controller
 * Coordinates tree, search, dashboard, and detail views for uisor datasets
 */

import { createLogger } from '../../logger.js';
import { getDataset } from '../../storage.js';
import { getActiveTab, subscribe } from '../../state.js';
import { renderTree, collapseAll, expandToDepth, selectNode, getSelectedNode, getReferenceMap } from './tree.js';
import { initSearch, filterTree } from './search.js';
import { renderDashboard } from './dashboard.js';
import { renderDetail } from './detail.js';
import { renderHierarchy, setImportId as setHierarchyImportId } from './hierarchy.js';

const log = createLogger('inventory');

let treeContainer = null;
let detailPanel = null;
let hierarchyPanel = null;
let dashboardPanel = null;
let currentDataset = null;

/**
 * Initialize inventory view
 */
export function initInventoryView() {
  log.info('Initializing inventory view');

  treeContainer = document.getElementById('tree-container');
  detailPanel = document.getElementById('detail-panel');
  hierarchyPanel = document.getElementById('hierarchy-panel');
  dashboardPanel = document.getElementById('dashboard-panel');

  // Setup toolbar buttons
  document.getElementById('collapse-all')?.addEventListener('click', () => {
    log.debug('Collapse all clicked');
    collapseAll();
  });

  document.getElementById('expand-depth')?.addEventListener('click', () => {
    const depth = prompt('Expand to depth (1-5):', '2');
    if (depth) {
      log.debug('Expand to depth', { depth });
      expandToDepth(parseInt(depth, 10));
    }
  });

  // Setup panel tabs
  setupPanelTabs();

  // Setup search
  initSearch(treeContainer, (matches) => {
    log.debug('Search results', { count: matches });
  });

  // Subscribe to tab changes
  subscribe((changeType, data) => {
    if (changeType === 'tabActivated') {
      loadDataset(data.datasetId);
    }
  });

  // Load initial dataset if tab is active
  const activeTab = getActiveTab();
  if (activeTab && activeTab.type === 'uisor') {
    loadDataset(activeTab.datasetId);
  }
}

/**
 * Setup detail/dashboard panel tabs
 */
function setupPanelTabs() {
  const tabs = document.querySelectorAll('.panel-tab');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const panel = tab.dataset.panel;
      log.debug('Panel tab clicked', { panel });

      // Update tab states
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show/hide panels
      detailPanel.classList.add('hidden');
      hierarchyPanel.classList.add('hidden');
      dashboardPanel.classList.add('hidden');

      if (panel === 'detail') {
        detailPanel.classList.remove('hidden');
      } else if (panel === 'hierarchy') {
        hierarchyPanel.classList.remove('hidden');
      } else if (panel === 'dashboard') {
        dashboardPanel.classList.remove('hidden');
      }
    });
  });
}

/**
 * Load and render a dataset
 */
export async function loadDataset(datasetId) {
  log.info('Loading dataset', { datasetId });
  log.time(`loadDataset:${datasetId}`);

  try {
    const dataset = await getDataset(datasetId);
    if (!dataset) {
      log.error('Dataset not found', { datasetId });
      showError('Dataset not found');
      return;
    }

    if (dataset.type !== 'uisor') {
      log.warn('Dataset is not uisor type', { type: dataset.type });
      showError(`Viewer for type "${dataset.type}" not implemented`);
      return;
    }

    currentDataset = dataset;

    // Render tree
    log.debug('Rendering tree');
    renderTree(treeContainer, dataset.payload, (node) => {
      log.debug('Node selected', { name: node.name, reference: node.reference });
      renderDetail(detailPanel, node);
      renderHierarchy(hierarchyPanel, node, getReferenceMap());
    });

    // Render dashboard
    log.debug('Rendering dashboard');
    renderDashboard(dashboardPanel, dataset);

    // Clear detail and hierarchy panels
    renderDetail(detailPanel, null);
    renderHierarchy(hierarchyPanel, null);

    log.timeEnd(`loadDataset:${datasetId}`);
    log.info('Dataset loaded', {
      project: dataset.payload.project?.name,
      apps: dataset.index?.appCount,
      elements: dataset.index?.elementCount
    });

  } catch (e) {
    log.error('Failed to load dataset', { error: e.message });
    showError(`Failed to load: ${e.message}`);
  }
}

/**
 * Show error in tree container
 */
function showError(message) {
  treeContainer.innerHTML = `
    <div class="empty-state">
      <p>Error: ${message}</p>
    </div>
  `;
}

/**
 * Get current dataset
 */
export function getCurrentDataset() {
  return currentDataset;
}
