/**
 * Hierarchy View for Inventory
 * Shows selected element and all descendants as nested list with screenshots
 */

import { createLogger } from '../../logger.js';
import { getEntryName, FIELDS } from '../../schema.js';
import { getScreenshot } from '../../storage.js';

const log = createLogger('hierarchy');

let currentNode = null;
let referenceMap = null;
let currentImportId = null;

/**
 * Set the current import ID for screenshot loading
 */
export function setImportId(importId) {
  currentImportId = importId;
}

/**
 * Set reference map from tree module
 */
export function setReferenceMap(map) {
  referenceMap = map;
}

/**
 * Render hierarchy panel for selected node
 */
export function renderHierarchy(container, node, refMap) {
  if (refMap) {
    referenceMap = refMap;
  }

  currentNode = node;

  const titleEl = container.querySelector('#hierarchy-title');
  const contentEl = container.querySelector('#hierarchy-content') || container.querySelector('.hierarchy-content');

  if (!node) {
    if (titleEl) titleEl.textContent = 'Select an element';
    if (contentEl) contentEl.innerHTML = '<div class="empty-state"><p>Click on a node in the tree to view its hierarchy</p></div>';
    return;
  }

  const displayName = getEntryName(node);
  log.debug('Rendering hierarchy', { name: displayName, type: node.type });

  if (titleEl) titleEl.textContent = `${displayName} - Hierarchy`;

  // Build hierarchy HTML
  const html = [];

  // Breadcrumb path
  html.push('<div class="hierarchy-breadcrumb">');
  html.push(renderBreadcrumb(node));
  html.push('</div>');

  // Descendants tree with screenshots
  html.push('<div class="hierarchy-tree">');
  html.push(renderNodeWithDescendants(node, 0));
  html.push('</div>');

  if (contentEl) {
    contentEl.innerHTML = html.join('');
    // Load screenshots after rendering
    loadScreenshots(contentEl);
  }
}

/**
 * Render breadcrumb path to current node
 */
function renderBreadcrumb(node) {
  const path = [];
  let current = node;

  // Build path by following parent_ref
  while (current) {
    path.unshift(current);
    if (current.parent_ref && referenceMap) {
      const parent = referenceMap.get(current.parent_ref);
      current = parent?.data;
    } else {
      current = null;
    }
  }

  return path.map((n, i) => {
    const name = getEntryName(n);
    const isLast = i === path.length - 1;
    return `<span class="breadcrumb-item ${isLast ? 'current' : ''}">${escapeHtml(name)}</span>`;
  }).join('<span class="breadcrumb-sep">›</span>');
}

/**
 * Render node with all descendants as nested list
 */
function renderNodeWithDescendants(node, depth) {
  const name = getEntryName(node);
  const type = node.type || (node.versions ? 'app' : node.screens ? 'version' : node.element_type ? 'element' : 'screen');
  const hasVars = hasVariables(node);
  const status = getNodeStatus(node);

  // Get screenshot filename
  const screenshot = node[FIELDS.screen.screenshot] || node[FIELDS.element.screenshot];

  let html = `
    <div class="hierarchy-node depth-${Math.min(depth, 5)}" data-ref="${escapeAttr(node.reference || '')}">
      <div class="hierarchy-node-content">
        <div class="hierarchy-node-header">
          <span class="status-indicator status-${status}"></span>
          <span class="hierarchy-node-name">${escapeHtml(name)}</span>
          <span class="type-badge">${escapeHtml(type)}</span>
          ${hasVars ? '<span class="var-badge">VAR</span>' : ''}
          ${node.has_image ? '<span class="targeting-badge available">I</span>' : ''}
          ${node.has_cv ? '<span class="targeting-badge available">CV</span>' : ''}
        </div>
        ${screenshot ? `
          <div class="hierarchy-screenshot">
            <img class="hierarchy-screenshot-img"
                 data-screenshot="${escapeAttr(screenshot)}"
                 alt="Screenshot of ${escapeAttr(name)}">
          </div>
        ` : ''}
      </div>
  `;

  // Get children
  const children = getChildren(node);

  if (children.length > 0) {
    html += '<div class="hierarchy-children">';
    for (const child of children) {
      html += renderNodeWithDescendants(child, depth + 1);
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

/**
 * Get children of a node
 */
function getChildren(node) {
  const children = [];

  // Apps have versions
  if (node.versions && node.versions.length > 0) {
    children.push(...node.versions);
  }

  // Versions have screens
  if (node.screens && node.screens.length > 0) {
    children.push(...node.screens);
  }

  // Screens have elements
  if (node.elements && node.elements.length > 0) {
    children.push(...node.elements);
  }

  // Elements have children
  if (node.children && node.children.length > 0) {
    children.push(...node.children);
  }

  return children;
}

/**
 * Check if node has variables
 */
function hasVariables(node) {
  return (node.declared_variables?.length > 0) ||
         (node.scope_variables?.length > 0) ||
         (node.selector_variables?.length > 0);
}

/**
 * Get status color for node
 */
function getNodeStatus(node) {
  if (node.type === 'screen' || node.url !== undefined) {
    const status = node[FIELDS.screen.status] || node.status;
    if (status === 'parameterized') return 'green';
    if (status === 'hardcoded') return 'red';
    return 'yellow';
  }

  // Element
  if (hasVariables(node)) return 'green';
  return 'yellow';
}

/**
 * Load screenshots from storage and display them
 */
async function loadScreenshots(container) {
  if (!container || !currentImportId) {
    log.debug('Cannot load screenshots', { hasContainer: !!container, hasImportId: !!currentImportId });
    return;
  }

  const screenshots = container.querySelectorAll('.hierarchy-screenshot-img[data-screenshot]');
  log.debug('Loading hierarchy screenshots', { count: screenshots.length });

  for (const img of screenshots) {
    const filename = img.dataset.screenshot;
    if (!filename) continue;

    img.classList.add('loading');
    img.alt = 'Loading...';

    try {
      const blob = await getScreenshot(currentImportId, filename);
      if (blob) {
        const url = URL.createObjectURL(blob);
        img.src = url;
        img.classList.remove('loading');

        // Setup click to zoom
        img.addEventListener('click', () => {
          showScreenshotModal(url, img.alt);
        });
      } else {
        img.alt = 'Screenshot not found';
        img.classList.remove('loading');
      }
    } catch (e) {
      log.error('Failed to load screenshot', { filename, error: e.message });
      img.alt = 'Failed to load';
      img.classList.remove('loading');
    }
  }
}

/**
 * Show screenshot in fullscreen modal
 */
function showScreenshotModal(url, alt) {
  const modal = document.createElement('div');
  modal.className = 'screenshot-modal';
  modal.innerHTML = `<img src="${url}" alt="${escapeAttr(alt)}">`;

  modal.addEventListener('click', () => {
    modal.remove();
  });

  document.addEventListener('keydown', function onEscape(e) {
    if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', onEscape);
    }
  });

  document.body.appendChild(modal);
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
