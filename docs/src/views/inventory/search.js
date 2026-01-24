/**
 * Search and Filter for Inventory View
 * Debounced filtering with pre-built search index
 */

import { createLogger } from '../../logger.js';
import { highlightMatches, expandToDepth } from './tree.js';

const log = createLogger('search');

const DEBOUNCE_MS = 300;

let searchInput = null;
let treeContainer = null;
let onResultsCallback = null;
let searchIndex = null;
let debounceTimer = null;

// Filter state
let filters = {
  hasVariables: false,
  noVariables: false,
  hasImage: false,
  hasCv: false
};

/**
 * Initialize search
 */
export function initSearch(container, onResults) {
  log.info('Initializing search');

  treeContainer = container;
  onResultsCallback = onResults;

  searchInput = document.getElementById('search-input');
  const filterHasVariables = document.getElementById('filter-has-variables');
  const filterNoVariables = document.getElementById('filter-no-variables');
  const filterHasImage = document.getElementById('filter-has-image');
  const filterHasCv = document.getElementById('filter-has-cv');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      debouncedSearch(e.target.value);
    });

    // Clear on Escape
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        debouncedSearch('');
      }
    });
  }

  // Setup filter toggles
  if (filterHasVariables) {
    filterHasVariables.addEventListener('change', (e) => {
      filters.hasVariables = e.target.checked;
      // Uncheck "without variables" if "with variables" is checked
      if (e.target.checked && filterNoVariables) {
        filters.noVariables = false;
        filterNoVariables.checked = false;
      }
      log.debug('Filter changed: hasVariables', { value: filters.hasVariables });
      runSearch(searchInput?.value || '');
    });
  }

  if (filterNoVariables) {
    filterNoVariables.addEventListener('change', (e) => {
      filters.noVariables = e.target.checked;
      // Uncheck "with variables" if "without variables" is checked
      if (e.target.checked && filterHasVariables) {
        filters.hasVariables = false;
        filterHasVariables.checked = false;
      }
      log.debug('Filter changed: noVariables', { value: filters.noVariables });
      runSearch(searchInput?.value || '');
    });
  }

  if (filterHasImage) {
    filterHasImage.addEventListener('change', (e) => {
      filters.hasImage = e.target.checked;
      log.debug('Filter changed: hasImage', { value: filters.hasImage });
      runSearch(searchInput?.value || '');
    });
  }

  if (filterHasCv) {
    filterHasCv.addEventListener('change', (e) => {
      filters.hasCv = e.target.checked;
      log.debug('Filter changed: hasCv', { value: filters.hasCv });
      runSearch(searchInput?.value || '');
    });
  }
}

/**
 * Set search index from dataset
 */
export function setSearchIndex(index) {
  log.debug('Setting search index', { size: index?.searchIndex?.length });
  searchIndex = index;
}

/**
 * Debounced search
 */
function debouncedSearch(query) {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    runSearch(query);
  }, DEBOUNCE_MS);
}

/**
 * Run search
 */
function runSearch(query) {
  log.debug('Running search', { query, filters });
  log.time('search');

  if (!searchIndex || !searchIndex.searchIndex) {
    log.warn('No search index available');
    return;
  }

  const normalizedQuery = query.toLowerCase().trim();
  const results = [];

  for (const entry of searchIndex.searchIndex) {
    let matches = false;

    // Text search
    if (normalizedQuery) {
      // Search in name
      if (entry.name?.toLowerCase().includes(normalizedQuery)) {
        matches = true;
      }
      // Search in variables
      if (entry.variables?.some(v => v?.toLowerCase().includes(normalizedQuery))) {
        matches = true;
      }
      // Search in URL (for screens)
      if (entry.url?.toLowerCase().includes(normalizedQuery)) {
        matches = true;
      }
      // Search in selectors
      if (entry.selector?.toLowerCase().includes(normalizedQuery)) {
        matches = true;
      }
      if (entry.fullSelector?.toLowerCase().includes(normalizedQuery)) {
        matches = true;
      }
      if (entry.scopeSelector?.toLowerCase().includes(normalizedQuery)) {
        matches = true;
      }
      // Search in reference
      if (entry.reference?.toLowerCase().includes(normalizedQuery)) {
        matches = true;
      }
      // Search in path
      if (entry.path?.toLowerCase().includes(normalizedQuery)) {
        matches = true;
      }
    } else {
      // No text query, start with all entries
      matches = true;
    }

    // Apply filters
    const hasVars = entry.variables && entry.variables.length > 0;

    if (matches && filters.hasVariables) {
      // Only include items WITH variables
      if (!hasVars) matches = false;
    }

    if (matches && filters.noVariables) {
      // Only include items WITHOUT variables
      if (hasVars) matches = false;
    }

    if (matches && filters.hasImage) {
      if (!entry.hasImage) matches = false;
    }

    if (matches && filters.hasCv) {
      if (!entry.hasCv) matches = false;
    }

    if (matches) {
      results.push(entry);
    }
  }

  log.timeEnd('search');
  log.debug('Search complete', { results: results.length });

  const hasActiveFilter = normalizedQuery || filters.hasVariables || filters.noVariables || filters.hasImage || filters.hasCv;

  // Highlight matches and filter tree
  if (hasActiveFilter) {
    highlightMatches(results);
    filterTree(results, true);  // Pass true to indicate filter is active
  } else {
    // Clear filter - show all nodes
    filterTree([], false);
  }

  // Callback with results
  if (onResultsCallback) {
    onResultsCallback(results.length);
  }

  // Update result count display
  updateResultCount(results.length, searchIndex.searchIndex.length);
}

/**
 * Update result count display
 */
function updateResultCount(count, total) {
  // Could add a count display element
  const hasActiveSearch = searchInput?.value || filters.hardcodedOnly || filters.hasImage || filters.hasCv;
  if (hasActiveSearch) {
    log.info(`Search: ${count} of ${total} items match`);
  }
}

/**
 * Filter tree nodes visibility
 * Due to lazy loading, we need to expand all nodes first to make filtering work
 * @param {Array} matches - Matching entries
 * @param {boolean} isFilterActive - Whether any filter is active (even if 0 results)
 */
export function filterTree(matches, isFilterActive = false) {
  if (!treeContainer) return;

  const matchRefs = new Set(matches.map(m => m.reference));

  // Check if we should filter: either explicit flag or infer from matches/search
  const shouldFilter = isFilterActive || matchRefs.size > 0 || searchInput?.value;

  // Show all if no active filter
  if (!shouldFilter) {
    treeContainer.querySelectorAll('.tree-node').forEach(node => {
      node.style.display = '';
    });
    return;
  }

  // Expand all nodes to ensure lazy children are loaded
  expandToDepth(10);

  // Build set of refs to keep visible (matches + their ancestors)
  const visibleRefs = new Set(matchRefs);

  // Always keep project root visible
  visibleRefs.add('project');

  // Find and mark ancestor nodes of matches as visible
  for (const ref of matchRefs) {
    const nodeEl = treeContainer.querySelector(`[data-ref="${ref}"]`);
    if (nodeEl) {
      let parent = nodeEl.closest('.tree-children')?.closest('.tree-node');
      while (parent) {
        const parentRef = parent.dataset.ref;
        if (parentRef) visibleRefs.add(parentRef);
        parent = parent.closest('.tree-children')?.closest('.tree-node');
      }
    }
  }

  // Hide non-matching nodes
  treeContainer.querySelectorAll('.tree-node').forEach(node => {
    const ref = node.dataset.ref;
    if (ref && !visibleRefs.has(ref)) {
      node.style.display = 'none';
    } else {
      node.style.display = '';
    }
  });
}

/**
 * Clear search
 */
export function clearSearch() {
  if (searchInput) {
    searchInput.value = '';
  }
  filters = {
    hasVariables: false,
    noVariables: false,
    hasImage: false,
    hasCv: false
  };

  // Reset filter checkboxes
  const hasVariablesCheckbox = document.getElementById('filter-has-variables');
  const noVariablesCheckbox = document.getElementById('filter-no-variables');
  const hasImageCheckbox = document.getElementById('filter-has-image');
  const hasCvCheckbox = document.getElementById('filter-has-cv');
  if (hasVariablesCheckbox) hasVariablesCheckbox.checked = false;
  if (noVariablesCheckbox) noVariablesCheckbox.checked = false;
  if (hasImageCheckbox) hasImageCheckbox.checked = false;
  if (hasCvCheckbox) hasCvCheckbox.checked = false;

  // Show all nodes
  if (treeContainer) {
    treeContainer.querySelectorAll('.tree-node').forEach(node => {
      node.style.display = '';
    });
  }
}
