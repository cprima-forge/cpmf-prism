/**
 * Detail Panel for Inventory View
 * Shows selector viewer, search steps, and element metadata
 */

import { createLogger } from '../../logger.js';
import { getEntryName, getVariableName, getVariableDefault, FIELDS } from '../../schema.js';
import { getScreenshot } from '../../storage.js';

const log = createLogger('detail');

let currentNode = null;
let currentImportId = null;

/**
 * Set the current import ID for screenshot loading
 */
export function setImportId(importId) {
  currentImportId = importId;
}

/**
 * Render detail panel for selected node
 */
export function renderDetail(container, node) {
  currentNode = node;

  const detailContent = container.querySelector('#detail-content') || container.querySelector('.detail-content');
  const titleEl = container.querySelector('#detail-title');
  const exportBtn = container.querySelector('#export-pdf');

  if (!node) {
    if (titleEl) titleEl.textContent = 'Select an element';
    if (detailContent) detailContent.innerHTML = '<div class="empty-state"><p>Click on a node in the tree to view details</p></div>';
    if (exportBtn) exportBtn.disabled = true;
    return;
  }

  const displayName = getEntryName(node);
  log.debug('Rendering detail', { name: displayName, type: node.element_type });

  if (titleEl) titleEl.textContent = displayName;
  if (exportBtn) {
    exportBtn.disabled = false;
    exportBtn.onclick = () => window.print();
  }

  // Determine node type and render appropriate content
  const html = [];

  // Screenshot (v0.1.2)
  const screenshot = node[FIELDS.screen.screenshot] || node[FIELDS.element.screenshot];
  if (screenshot) {
    const width = node[FIELDS.screen.screenshotWidth] || node[FIELDS.element.screenshotWidth];
    const height = node[FIELDS.screen.screenshotHeight] || node[FIELDS.element.screenshotHeight];
    html.push(`
      <div class="detail-section">
        <h3>Screenshot</h3>
        <div class="screenshot-container">
          <img class="screenshot-img"
               data-screenshot="${escapeAttr(screenshot)}"
               alt="Screenshot of ${escapeAttr(displayName)}"
               ${width ? `data-width="${width}"` : ''}
               ${height ? `data-height="${height}"` : ''}>
          <div class="screenshot-info">${width || '?'} × ${height || '?'}</div>
        </div>
      </div>
    `);
  }

  // Reference
  if (node.reference) {
    html.push(`
      <div class="detail-section">
        <h3>Reference</h3>
        <code class="reference-code">${escapeHtml(node.reference)}</code>
      </div>
    `);
  }

  // Element type and activity (for elements)
  if (node.element_type || node.activity_type) {
    html.push(`
      <div class="detail-section">
        <h3>Type</h3>
        <div class="type-info">
          ${node.element_type ? `<span class="type-badge">${escapeHtml(node.element_type)}</span>` : ''}
          ${node.activity_type ? `<span class="activity-badge">${escapeHtml(node.activity_type)}</span>` : ''}
        </div>
      </div>
    `);
  }

  // URL (for screens)
  if (node.url !== undefined) {
    html.push(`
      <div class="detail-section">
        <h3>URL</h3>
        <div class="selector-display">${escapeHtml(node.url || '(empty)')}</div>
        <div class="status-row">
          <span class="status-indicator status-${node[FIELDS.screen.status] === 'parameterized' ? 'green' : 'red'}"></span>
          <span>${node[FIELDS.screen.status] || 'unknown'}</span>
        </div>
      </div>
    `);
  }

  // Search steps visualization
  if (node.search_steps) {
    html.push(`
      <div class="detail-section">
        <h3>Search Steps</h3>
        ${renderSearchSteps(node)}
      </div>
    `);
  }

  // Selectors
  if (node.selector || node.full_selector || node.scope_selector || node.fuzzy_selector) {
    html.push(`
      <div class="detail-section">
        <h3>Selectors</h3>
        ${renderSelectors(node)}
      </div>
    `);
  }

  // Variables - handle both v0.1.0 (strings) and v0.1.1 ({name, default} objects)
  const allVars = [
    ...(node.declared_variables || []),
    ...(node.scope_variables || []),
    ...(node.selector_variables || [])
  ];
  if (allVars.length > 0) {
    html.push(`
      <div class="detail-section">
        <h3>Variables</h3>
        <div class="variables-list">
          ${allVars.map(v => {
            const name = getVariableName(v);
            const defaultVal = getVariableDefault(v);
            const defaultDisplay = defaultVal ? ` = ${escapeHtml(defaultVal)}` : '';
            return `<span class="variable-tag">${escapeHtml(name)}${defaultDisplay}</span>`;
          }).join('')}
        </div>
      </div>
    `);
  }

  // Targeting coverage
  if (node.has_image !== undefined || node.has_cv !== undefined) {
    html.push(`
      <div class="detail-section">
        <h3>Targeting Coverage</h3>
        <div class="coverage-grid">
          <div class="coverage-item">
            <span class="coverage-label">Image:</span>
            <span class="coverage-value ${node.has_image ? 'yes' : 'no'}">${node.has_image ? 'Yes' : 'No'}</span>
          </div>
          <div class="coverage-item">
            <span class="coverage-label">Computer Vision:</span>
            <span class="coverage-value ${node.has_cv ? 'yes' : 'no'}">${node.has_cv ? 'Yes' : 'No'}</span>
            ${node.cv_type ? `<span class="cv-type">(${escapeHtml(node.cv_type)})</span>` : ''}
          </div>
        </div>
      </div>
    `);
  }

  // Visibility and Wait
  if (node.visibility || node.wait_for_ready) {
    html.push(`
      <div class="detail-section">
        <h3>Interaction Settings</h3>
        <div class="settings-grid">
          ${node.visibility ? `<div><strong>Visibility:</strong> ${escapeHtml(node.visibility)}</div>` : ''}
          ${node.wait_for_ready ? `<div><strong>Wait for Ready:</strong> ${escapeHtml(node.wait_for_ready)}</div>` : ''}
        </div>
      </div>
    `);
  }

  // Timestamps
  if (node.created || node.updated) {
    html.push(`
      <div class="detail-section">
        <h3>History</h3>
        <div class="history-info">
          ${node.created ? `<div><strong>Created:</strong> ${formatDate(node.created)}</div>` : ''}
          ${node.updated ? `<div><strong>Updated:</strong> ${formatDate(node.updated)}</div>` : ''}
        </div>
      </div>
    `);
  }

  if (detailContent) {
    detailContent.innerHTML = html.join('');
  }

  // Setup copy buttons
  setupCopyButtons(detailContent);

  // Load screenshots
  loadScreenshots(detailContent);
}

/**
 * Render search steps visualization
 */
function renderSearchSteps(node) {
  const steps = ['Selector', 'FuzzySelector', 'Image', 'CV'];
  const activeSteps = node.search_steps?.split(',').map(s => s.trim()) || [];

  return `
    <div class="search-steps">
      ${steps.map((step, i) => {
        const isActive = activeSteps.some(s =>
          s.toLowerCase().includes(step.toLowerCase().replace('selector', ''))
        ) || (step === 'Image' && node.has_image) || (step === 'CV' && node.has_cv);

        return `
          ${i > 0 ? '<span class="search-step-arrow">→</span>' : ''}
          <span class="search-step ${isActive ? 'available' : ''}">${step}</span>
        `;
      }).join('')}
    </div>
    <div class="search-steps-raw">
      <small>Raw: ${escapeHtml(node.search_steps || 'N/A')}</small>
    </div>
  `;
}

/**
 * Render selectors with syntax highlighting
 */
function renderSelectors(node) {
  const selectors = [
    { label: 'Screen Selector', value: node.selector },
    { label: 'Scope Selector', value: node.scope_selector },
    { label: 'Full Selector', value: node.full_selector },
    { label: 'Fuzzy Selector', value: node.fuzzy_selector }
  ].filter(s => s.value);

  return selectors.map(s => `
    <div class="selector-block">
      <div class="selector-label">
        ${s.label}
        <button class="copy-btn btn btn-small" data-copy="${escapeAttr(s.value)}">Copy</button>
      </div>
      <div class="selector-display">${highlightSelector(s.value)}</div>
    </div>
  `).join('');
}

/**
 * Simple syntax highlighting for selectors
 */
function highlightSelector(selector) {
  if (!selector) return '';

  // Escape HTML first
  let html = escapeHtml(selector);

  // Highlight tags <tagname ...>
  html = html.replace(/&lt;(\/?[\w-]+)/g, '&lt;<span class="tag">$1</span>');

  // Highlight attributes attr='value'
  html = html.replace(/([\w-]+)=&#39;([^&#]*?)&#39;/g,
    '<span class="attr">$1</span>=&#39;<span class="value">$2</span>&#39;');
  html = html.replace(/([\w-]+)=&quot;([^&]*?)&quot;/g,
    '<span class="attr">$1</span>=&quot;<span class="value">$2</span>&quot;');

  return html;
}

/**
 * Setup copy buttons
 */
function setupCopyButtons(container) {
  container?.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const text = btn.dataset.copy;
      try {
        await navigator.clipboard.writeText(text);
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => {
          btn.textContent = originalText;
        }, 1500);
      } catch (e) {
        log.error('Copy failed', { error: e.message });
      }
    });
  });
}

/**
 * Load screenshots from storage and display them
 */
async function loadScreenshots(container) {
  if (!container || !currentImportId) return;

  const screenshots = container.querySelectorAll('.screenshot-img[data-screenshot]');
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

        // Cleanup blob URL when image is removed
        img.addEventListener('load', () => {
          // Keep URL alive while image is displayed
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

/**
 * Format date string
 */
function formatDate(dateStr) {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  } catch {
    return dateStr;
  }
}

/**
 * Get current node
 */
export function getCurrentNode() {
  return currentNode;
}

// Utility functions
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}
