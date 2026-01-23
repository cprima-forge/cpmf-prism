/**
 * State Management for rpax prism
 * Manages UI state with LocalStorage persistence
 */

import { createLogger } from './logger.js';

const log = createLogger('state');

const STORAGE_KEY = 'rpax-prism-ui-state';

// Default state
const defaultState = {
  activeImportId: null,
  selectedDatasets: {}, // { importId: datasetId }
  openTabs: [],         // [{ datasetId, type, label, active }]
  theme: 'solarized-light'
};

// Current state (in memory)
let state = { ...defaultState };

// State change listeners
const listeners = new Set();

/**
 * Initialize state from LocalStorage
 */
export function initState() {
  log.info('Initializing state');

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      state = { ...defaultState, ...parsed };
      log.info('State loaded from storage', state);
    } else {
      log.info('No saved state, using defaults');
    }
  } catch (e) {
    log.error('Failed to load state', { error: e.message });
    state = { ...defaultState };
  }

  return state;
}

/**
 * Save state to LocalStorage
 */
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    log.debug('State saved');
  } catch (e) {
    log.error('Failed to save state', { error: e.message });
  }
}

/**
 * Notify listeners of state change
 */
function notifyListeners(changeType, data) {
  log.debug('Notifying listeners', { changeType, listenerCount: listeners.size });
  for (const listener of listeners) {
    try {
      listener(changeType, data, state);
    } catch (e) {
      log.error('Listener error', { error: e.message });
    }
  }
}

/**
 * Subscribe to state changes
 */
export function subscribe(listener) {
  listeners.add(listener);
  log.debug('Listener subscribed', { totalListeners: listeners.size });

  // Return unsubscribe function
  return () => {
    listeners.delete(listener);
    log.debug('Listener unsubscribed', { totalListeners: listeners.size });
  };
}

/**
 * Get current state
 */
export function getState() {
  return { ...state };
}

// ============ TABS ============

/**
 * Open a new tab
 */
export function openTab(datasetId, type, label) {
  log.info('Opening tab', { datasetId, type, label });

  // Check if tab already exists
  const existingIndex = state.openTabs.findIndex(t => t.datasetId === datasetId);
  if (existingIndex >= 0) {
    log.debug('Tab already exists, activating');
    return setActiveTab(datasetId);
  }

  // Deactivate all tabs
  state.openTabs = state.openTabs.map(t => ({ ...t, active: false }));

  // Add new tab
  state.openTabs.push({
    datasetId,
    type,
    label,
    active: true
  });

  saveState();
  notifyListeners('tabOpened', { datasetId, type, label });

  return state;
}

/**
 * Close a tab
 */
export function closeTab(datasetId) {
  log.info('Closing tab', { datasetId });

  const index = state.openTabs.findIndex(t => t.datasetId === datasetId);
  if (index < 0) {
    log.warn('Tab not found');
    return state;
  }

  const wasActive = state.openTabs[index].active;
  state.openTabs.splice(index, 1);

  // If closed tab was active, activate another
  if (wasActive && state.openTabs.length > 0) {
    const newActiveIndex = Math.min(index, state.openTabs.length - 1);
    state.openTabs[newActiveIndex].active = true;
    log.debug('Activated adjacent tab', { datasetId: state.openTabs[newActiveIndex].datasetId });
  }

  saveState();
  notifyListeners('tabClosed', { datasetId });

  return state;
}

/**
 * Set active tab
 */
export function setActiveTab(datasetId) {
  log.info('Setting active tab', { datasetId });

  let found = false;
  state.openTabs = state.openTabs.map(t => {
    if (t.datasetId === datasetId) {
      found = true;
      return { ...t, active: true };
    }
    return { ...t, active: false };
  });

  if (!found) {
    log.warn('Tab not found', { datasetId });
    return state;
  }

  saveState();
  notifyListeners('tabActivated', { datasetId });

  return state;
}

/**
 * Get active tab
 */
export function getActiveTab() {
  return state.openTabs.find(t => t.active) || null;
}

// ============ IMPORTS & DATASETS ============

/**
 * Set active import
 */
export function setActiveImport(importId) {
  log.info('Setting active import', { importId });

  state.activeImportId = importId;
  saveState();
  notifyListeners('importActivated', { importId });

  return state;
}

/**
 * Set selected dataset for an import
 */
export function setSelectedDataset(importId, datasetId) {
  log.info('Setting selected dataset', { importId, datasetId });

  state.selectedDatasets[importId] = datasetId;
  saveState();
  notifyListeners('datasetSelected', { importId, datasetId });

  return state;
}

/**
 * Get selected dataset for an import
 */
export function getSelectedDataset(importId) {
  return state.selectedDatasets[importId] || null;
}

// ============ THEME ============

/**
 * Set theme
 */
export function setTheme(theme) {
  log.info('Setting theme', { theme });

  state.theme = theme;
  saveState();
  notifyListeners('themeChanged', { theme });

  return state;
}

/**
 * Get current theme
 */
export function getTheme() {
  return state.theme;
}

// ============ CLEANUP ============

/**
 * Clear all state
 */
export function clearState() {
  log.warn('Clearing all state');

  state = { ...defaultState };
  saveState();
  notifyListeners('stateCleared', {});

  return state;
}

/**
 * Remove tabs for a deleted import
 */
export function removeImportTabs(importId) {
  log.info('Removing tabs for import', { importId });

  const initialCount = state.openTabs.length;
  state.openTabs = state.openTabs.filter(t => !t.datasetId.startsWith(importId));

  if (state.activeImportId === importId) {
    state.activeImportId = null;
  }

  delete state.selectedDatasets[importId];

  // Ensure at least one tab is active if tabs remain
  if (state.openTabs.length > 0 && !state.openTabs.some(t => t.active)) {
    state.openTabs[0].active = true;
  }

  saveState();
  log.debug('Tabs removed', { removed: initialCount - state.openTabs.length });
  notifyListeners('importTabsRemoved', { importId });

  return state;
}
