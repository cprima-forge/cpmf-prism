/**
 * Tree View Renderer for Inventory
 * Builds hierarchy from flat entries[] array using parent_ref
 */

import { createLogger } from '../../logger.js';
import { getScreenName, getElementName, FIELDS } from '../../schema.js';

const log = createLogger('tree');

let container = null;
let onSelectCallback = null;
let selectedNode = null;
let referenceMap = new Map(); // O(1) lookup by reference
let hierarchyRoot = null; // Built tree structure

/**
 * Render the inventory tree
 * Data structure: { project, library, entries[] } where entries are flat with parent_ref
 */
export function renderTree(containerEl, payload, onSelect) {
  log.info('Rendering tree');
  log.time('renderTree');

  container = containerEl;
  onSelectCallback = onSelect;
  selectedNode = null;
  referenceMap.clear();

  if (!payload || !payload.entries) {
    container.innerHTML = '<div class="empty-state"><p>No data to display</p></div>';
    return;
  }

  // Build hierarchy from flat entries
  hierarchyRoot = buildHierarchy(payload);
  log.debug('Hierarchy built', {
    apps: hierarchyRoot.apps.length,
    totalEntries: payload.entries.length
  });

  // Build tree HTML
  const html = [];

  // Project root
  if (payload.project) {
    referenceMap.set('project', { type: 'project', data: payload.project });
    html.push(`
      <div class="tree-node tree-root">
        <details open>
          <summary>
            <span class="node-name" data-ref="project">${escapeHtml(payload.project.name || 'Project')}</span>
            <span class="type-badge">project</span>
          </summary>
          <div class="tree-children">
    `);
  }

  // Render apps
  for (const app of hierarchyRoot.apps) {
    html.push(renderAppNode(app));
  }

  if (payload.project) {
    html.push('</div></details></div>');
  }

  container.innerHTML = html.join('');

  // Setup lazy loading and click handlers
  setupEventHandlers();

  log.timeEnd('renderTree');
  log.info('Tree rendered', { apps: hierarchyRoot.apps.length });
}

/**
 * Build hierarchy from flat entries array
 * Entries have: type (screen/element), path (App/Version/Screen), parent_ref, reference
 */
function buildHierarchy(payload) {
  const hierarchy = {
    project: payload.project,
    apps: []
  };

  // Maps for building structure
  const appMap = new Map(); // appName -> app object
  const versionMap = new Map(); // "appName/version" -> version object
  const screenMap = new Map(); // reference -> screen object
  const elementsByParent = new Map(); // parent_ref -> children array

  // First pass: group entries by type and parent
  for (const entry of payload.entries) {
    // Store in reference map for O(1) lookup
    referenceMap.set(entry.reference, { type: entry.type, data: entry });

    if (entry.type === 'screen') {
      // Extract app/version from path (format: "AppName/Version/ScreenName")
      const pathParts = entry.path ? entry.path.split('/') : [];
      const appName = pathParts[0] || 'Unknown App';
      const versionName = pathParts[1] || 'v0.1.0';
      const versionKey = `${appName}/${versionName}`;

      // Create app if needed
      if (!appMap.has(appName)) {
        const app = {
          name: appName,
          reference: `app:${appName}`,
          versions: []
        };
        appMap.set(appName, app);
        referenceMap.set(app.reference, { type: 'app', data: app });
        hierarchy.apps.push(app);
      }

      // Create version if needed
      if (!versionMap.has(versionKey)) {
        const version = {
          name: versionName,
          reference: `version:${versionKey}`,
          screens: []
        };
        versionMap.set(versionKey, version);
        referenceMap.set(version.reference, { type: 'version', data: version });
        appMap.get(appName).versions.push(version);
      }

      // Add screen to version
      const screen = { ...entry, elements: [] };
      screenMap.set(entry.reference, screen);
      versionMap.get(versionKey).screens.push(screen);

    } else if (entry.type === 'element') {
      // Group elements by parent_ref
      const parentRef = entry.parent_ref;
      if (!elementsByParent.has(parentRef)) {
        elementsByParent.set(parentRef, []);
      }
      elementsByParent.get(parentRef).push({ ...entry, children: [] });
    }
  }

  // Second pass: attach elements to their parents (screens or other elements)
  for (const [parentRef, children] of elementsByParent) {
    // Check if parent is a screen
    if (screenMap.has(parentRef)) {
      screenMap.get(parentRef).elements = children;
    } else {
      // Parent is another element, find it in the elementsByParent values
      for (const [, siblings] of elementsByParent) {
        for (const element of siblings) {
          if (element.reference === parentRef) {
            element.children = children;
            break;
          }
        }
      }
    }
  }

  // Update reference map with built hierarchy
  for (const screen of screenMap.values()) {
    referenceMap.set(screen.reference, { type: 'screen', data: screen });
    indexElementsInMap(screen.elements);
  }

  return hierarchy;
}

/**
 * Recursively index elements in reference map
 */
function indexElementsInMap(elements) {
  for (const element of elements || []) {
    referenceMap.set(element.reference, { type: 'element', data: element });
    if (element.children && element.children.length > 0) {
      indexElementsInMap(element.children);
    }
  }
}

/**
 * Render an app node
 */
function renderAppNode(app) {
  const hasVersions = app.versions && app.versions.length > 0;

  return `
    <div class="tree-node ${!hasVersions ? 'tree-node-leaf' : ''}" data-ref="${escapeAttr(app.reference)}">
      <details>
        <summary>
          <span class="node-name" data-ref="${escapeAttr(app.reference)}">${escapeHtml(app.name)}</span>
          <span class="type-badge">app</span>
        </summary>
        ${hasVersions ? `<div class="tree-children" data-lazy="true" data-ref="${escapeAttr(app.reference)}"></div>` : ''}
      </details>
    </div>
  `;
}

/**
 * Render children lazily
 */
function renderLazyChildren(containerEl, parentRef) {
  log.debug('Loading lazy children', { parentRef });

  const parent = referenceMap.get(parentRef);
  if (!parent) {
    log.warn('Parent not found in reference map', { parentRef });
    return;
  }

  const html = [];

  switch (parent.type) {
    case 'app':
      for (const version of parent.data.versions || []) {
        html.push(renderVersionNode(version));
      }
      break;

    case 'version':
      for (const screen of parent.data.screens || []) {
        html.push(renderScreenNode(screen));
      }
      break;

    case 'screen':
      for (const element of parent.data.elements || []) {
        html.push(renderElementNode(element));
      }
      break;

    case 'element':
      for (const child of parent.data.children || []) {
        html.push(renderElementNode(child));
      }
      break;
  }

  containerEl.innerHTML = html.join('');
  containerEl.removeAttribute('data-lazy');

  // Setup handlers for new elements
  setupClickHandlers(containerEl);
}

/**
 * Render a version node
 */
function renderVersionNode(version) {
  const hasScreens = version.screens && version.screens.length > 0;

  return `
    <div class="tree-node ${!hasScreens ? 'tree-node-leaf' : ''}" data-ref="${escapeAttr(version.reference)}">
      <details>
        <summary>
          <span class="node-name" data-ref="${escapeAttr(version.reference)}">${escapeHtml(version.name)}</span>
          <span class="type-badge">version</span>
        </summary>
        ${hasScreens ? `<div class="tree-children" data-lazy="true" data-ref="${escapeAttr(version.reference)}"></div>` : ''}
      </details>
    </div>
  `;
}

/**
 * Render a screen node
 */
function renderScreenNode(screen) {
  const hasElements = screen.elements && screen.elements.length > 0;
  const status = getScreenStatus(screen);
  const displayName = getScreenName(screen);

  return `
    <div class="tree-node ${!hasElements ? 'tree-node-leaf' : ''}" data-ref="${escapeAttr(screen.reference)}">
      <details>
        <summary>
          <span class="status-indicator status-${status}"></span>
          <span class="node-name" data-ref="${escapeAttr(screen.reference)}">${escapeHtml(displayName)}</span>
          <span class="type-badge">screen</span>
        </summary>
        ${hasElements ? `<div class="tree-children" data-lazy="true" data-ref="${escapeAttr(screen.reference)}"></div>` : ''}
      </details>
    </div>
  `;
}

/**
 * Render an element node
 */
function renderElementNode(element) {
  const hasChildren = element.children && element.children.length > 0;
  const status = getElementStatus(element);
  const badges = getTargetingBadges(element);
  const displayName = getElementName(element);

  return `
    <div class="tree-node ${!hasChildren ? 'tree-node-leaf' : ''}" data-ref="${escapeAttr(element.reference)}">
      <details>
        <summary>
          <span class="status-indicator status-${status}"></span>
          <span class="node-name" data-ref="${escapeAttr(element.reference)}">${escapeHtml(displayName)}</span>
          ${element.element_type ? `<span class="type-badge">${escapeHtml(element.element_type)}</span>` : ''}
          <span class="targeting-badges">${badges}</span>
        </summary>
        ${hasChildren ? `<div class="tree-children" data-lazy="true" data-ref="${escapeAttr(element.reference)}"></div>` : ''}
      </details>
    </div>
  `;
}

/**
 * Get parameterization status for screen
 */
function getScreenStatus(screen) {
  const status = screen[FIELDS.screen.status];
  if (status === 'parameterized') return 'green';
  if (status === 'hardcoded') return 'red';
  return 'yellow';
}

/**
 * Get parameterization status for element
 */
function getElementStatus(element) {
  const hasVars = (element.scope_variables?.length > 0) ||
                  (element.selector_variables?.length > 0);
  if (hasVars) return 'green';
  return 'yellow';
}

/**
 * Get targeting badges HTML
 */
function getTargetingBadges(element) {
  const steps = element.search_steps || '';
  const badges = [];

  badges.push(`<span class="targeting-badge ${steps.includes('Selector') ? 'available' : 'inactive'}">S</span>`);
  badges.push(`<span class="targeting-badge ${steps.includes('Fuzzy') ? 'available' : 'inactive'}">F</span>`);
  badges.push(`<span class="targeting-badge ${element.has_image ? 'available' : 'inactive'}">I</span>`);
  badges.push(`<span class="targeting-badge ${element.has_cv ? 'available' : 'inactive'}">CV</span>`);

  return badges.join('');
}

/**
 * Setup event handlers
 */
function setupEventHandlers() {
  // Lazy loading on details open
  container.addEventListener('toggle', (e) => {
    if (e.target.tagName === 'DETAILS' && e.target.open) {
      const lazyContainer = e.target.querySelector('[data-lazy="true"]');
      if (lazyContainer) {
        const parentRef = lazyContainer.dataset.ref;
        renderLazyChildren(lazyContainer, parentRef);
      }
    }
  }, true);

  // Click handlers for selection
  setupClickHandlers(container);
}

/**
 * Setup click handlers for node selection
 */
function setupClickHandlers(parent) {
  parent.querySelectorAll('.node-name').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const ref = el.dataset.ref;
      selectNode(ref);
    });
  });
}

/**
 * Select a node by reference
 */
export function selectNode(ref) {
  log.debug('Selecting node', { ref });

  // Remove previous selection
  container.querySelectorAll('.node-name.selected').forEach(el => {
    el.classList.remove('selected');
  });

  // Add selection
  const nodeEl = container.querySelector(`.node-name[data-ref="${ref}"]`);
  if (nodeEl) {
    nodeEl.classList.add('selected');
  }

  // Get node data
  const entry = referenceMap.get(ref);
  if (entry) {
    selectedNode = entry.data;
    if (onSelectCallback) {
      onSelectCallback(entry.data);
    }
  }
}

/**
 * Get currently selected node
 */
export function getSelectedNode() {
  return selectedNode;
}

/**
 * Get reference map for hierarchy navigation
 */
export function getReferenceMap() {
  return referenceMap;
}

/**
 * Collapse all nodes
 */
export function collapseAll() {
  log.debug('Collapsing all');
  container.querySelectorAll('details[open]').forEach(el => {
    el.open = false;
  });
}

/**
 * Expand nodes to a specific depth
 */
export function expandToDepth(depth) {
  log.debug('Expanding to depth', { depth });

  // First collapse all
  collapseAll();

  // Then expand to depth
  expandLevel(container, 0, depth);
}

function expandLevel(parent, currentDepth, maxDepth) {
  if (currentDepth >= maxDepth) return;

  parent.querySelectorAll(':scope > .tree-node > details').forEach(details => {
    details.open = true;

    // Trigger lazy load
    const lazyContainer = details.querySelector('[data-lazy="true"]');
    if (lazyContainer) {
      renderLazyChildren(lazyContainer, lazyContainer.dataset.ref);
    }

    // Recurse
    const childContainer = details.querySelector('.tree-children');
    if (childContainer) {
      expandLevel(childContainer, currentDepth + 1, maxDepth);
    }
  });
}

/**
 * Highlight nodes matching search
 */
export function highlightMatches(matches) {
  // Clear existing highlights
  container.querySelectorAll('.search-match').forEach(el => {
    el.outerHTML = el.textContent;
  });

  // Apply new highlights
  for (const match of matches) {
    const nodeEl = container.querySelector(`.node-name[data-ref="${match.reference}"]`);
    if (nodeEl) {
      // Expand parents to show match
      expandToNode(nodeEl);
    }
  }
}

function expandToNode(nodeEl) {
  let parent = nodeEl.closest('details');
  while (parent) {
    parent.open = true;

    // Trigger lazy load if needed
    const lazyContainer = parent.querySelector('[data-lazy="true"]');
    if (lazyContainer) {
      renderLazyChildren(lazyContainer, lazyContainer.dataset.ref);
    }

    parent = parent.parentElement?.closest('details');
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
