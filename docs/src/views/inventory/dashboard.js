/**
 * Dashboard View for Inventory
 * Summary statistics and parameterization overview
 * Data structure: { project, library, entries[] } where entries are flat with parent_ref
 */

import { createLogger } from '../../logger.js';
import { getVariableName, FIELDS } from '../../schema.js';

const log = createLogger('dashboard');

/**
 * Render dashboard panel
 */
export function renderDashboard(container, dataset) {
  log.info('Rendering dashboard');

  if (!dataset || !dataset.payload) {
    container.innerHTML = '<div class="empty-state"><p>No data to display</p></div>';
    return;
  }

  const stats = computeStats(dataset);
  log.debug('Computed stats', stats);

  container.innerHTML = `
    <div class="stat-card">
      <h4>Project</h4>
      <div class="stat-value">${escapeHtml(dataset.payload.project?.name || 'Unknown')}</div>
      <div class="stat-detail">v${escapeHtml(dataset.payload.project?.version || '0.1.0')}</div>
    </div>

    <div class="stat-card">
      <h4>Apps</h4>
      <div class="stat-value">${stats.appCount}</div>
    </div>

    <div class="stat-card">
      <h4>Versions</h4>
      <div class="stat-value">${stats.versionCount}</div>
    </div>

    <div class="stat-card">
      <h4>Screens</h4>
      <div class="stat-value">${stats.screenCount}</div>
      ${renderMiniBar(stats.screenParameterized, stats.screenCount, 'Parameterized')}
    </div>

    <div class="stat-card">
      <h4>Elements</h4>
      <div class="stat-value">${stats.elementCount}</div>
    </div>

    <div class="stat-card">
      <h4>Screen URL Status</h4>
      ${renderStatusBreakdown(stats.urlStatus)}
    </div>

    <div class="stat-card">
      <h4>Targeting Methods</h4>
      <div class="targeting-stats">
        <div class="targeting-stat">
          <span class="stat-label">With Image:</span>
          <span class="stat-num">${stats.withImage}</span>
        </div>
        <div class="targeting-stat">
          <span class="stat-label">With CV:</span>
          <span class="stat-num">${stats.withCv}</span>
        </div>
        <div class="targeting-stat">
          <span class="stat-label">With Fuzzy:</span>
          <span class="stat-num">${stats.withFuzzy}</span>
        </div>
      </div>
    </div>

    <div class="stat-card">
      <h4>Variables Used</h4>
      <div class="stat-value">${stats.uniqueVariables.size}</div>
      <div class="variables-preview">
        ${[...stats.uniqueVariables].slice(0, 5).map(v =>
          `<span class="variable-tag">${escapeHtml(v)}</span>`
        ).join('')}
        ${stats.uniqueVariables.size > 5 ? `<span class="more">+${stats.uniqueVariables.size - 5} more</span>` : ''}
      </div>
    </div>

    <div class="stat-card">
      <h4>Framework</h4>
      <div class="stat-detail">
        <div>Studio: ${escapeHtml(dataset.payload.project?.studio_version || '?')}</div>
        <div>Target: ${escapeHtml(dataset.payload.project?.target_framework || '?')}</div>
        <div>UI Automation: ${escapeHtml(dataset.payload.project?.ui_automation_version || '?')}</div>
      </div>
    </div>
  `;
}

/**
 * Compute statistics from dataset
 * Processes flat entries[] array
 */
function computeStats(dataset) {
  const stats = {
    appCount: 0,
    versionCount: 0,
    screenCount: 0,
    elementCount: 0,
    screenParameterized: 0,
    urlStatus: {
      hardcoded: 0,
      parameterized: 0,
      unknown: 0
    },
    withImage: 0,
    withCv: 0,
    withFuzzy: 0,
    uniqueVariables: new Set()
  };

  // Use pre-built index if available
  if (dataset.index) {
    stats.appCount = dataset.index.appCount || 0;
    stats.versionCount = dataset.index.versionCount || 0;
    stats.screenCount = dataset.index.screenCount || 0;
    stats.elementCount = dataset.index.elementCount || 0;
  }

  // Track unique apps and versions from paths
  const apps = new Set();
  const versions = new Set();

  // Process flat entries array
  const entries = dataset.payload.entries || [];
  for (const entry of entries) {
    // Extract app/version from path
    if (entry.path) {
      const pathParts = entry.path.split('/');
      if (pathParts.length >= 1) apps.add(pathParts[0]);
      if (pathParts.length >= 2) versions.add(`${pathParts[0]}/${pathParts[1]}`);
    }

    if (entry.type === 'screen') {
      if (!dataset.index) stats.screenCount++;

      // URL status
      switch (entry[FIELDS.screen.status]) {
        case 'hardcoded':
          stats.urlStatus.hardcoded++;
          break;
        case 'parameterized':
          stats.urlStatus.parameterized++;
          stats.screenParameterized++;
          break;
        default:
          stats.urlStatus.unknown++;
      }

      // Collect variables from screens - handle both v0.1.0 (strings) and v0.1.1 ({name, default})
      for (const v of entry.declared_variables || []) {
        stats.uniqueVariables.add(getVariableName(v));
      }

    } else if (entry.type === 'element') {
      if (!dataset.index) stats.elementCount++;

      // Targeting methods
      if (entry.has_image) stats.withImage++;
      if (entry.has_cv) stats.withCv++;
      if (entry.search_steps?.includes('Fuzzy')) stats.withFuzzy++;

      // Variables from elements - handle both formats
      for (const v of entry.declared_variables || []) {
        stats.uniqueVariables.add(getVariableName(v));
      }
      for (const v of entry.scope_variables || []) {
        stats.uniqueVariables.add(getVariableName(v));
      }
      for (const v of entry.selector_variables || []) {
        stats.uniqueVariables.add(getVariableName(v));
      }
    }
  }

  // Update counts from path analysis if not from index
  if (!dataset.index) {
    stats.appCount = apps.size;
    stats.versionCount = versions.size;
  }

  return stats;
}

/**
 * Render a mini progress bar
 */
function renderMiniBar(value, total, label) {
  if (total === 0) return '';
  const percent = Math.round((value / total) * 100);

  return `
    <div class="stat-bar" title="${label}: ${value}/${total}">
      <div class="stat-bar-fill" style="width: ${percent}%"></div>
    </div>
    <div class="stat-detail">${percent}% ${label.toLowerCase()}</div>
  `;
}

/**
 * Render status breakdown
 */
function renderStatusBreakdown(urlStatus) {
  const total = urlStatus.hardcoded + urlStatus.parameterized + urlStatus.unknown;
  if (total === 0) return '<div class="stat-detail">No screens</div>';

  return `
    <div class="status-breakdown">
      <div class="status-row">
        <span class="status-indicator status-green"></span>
        <span>Parameterized: ${urlStatus.parameterized}</span>
      </div>
      <div class="status-row">
        <span class="status-indicator status-red"></span>
        <span>Hardcoded: ${urlStatus.hardcoded}</span>
      </div>
      ${urlStatus.unknown > 0 ? `
        <div class="status-row">
          <span class="status-indicator status-yellow"></span>
          <span>Unknown: ${urlStatus.unknown}</span>
        </div>
      ` : ''}
    </div>
  `;
}

// getVariableName imported from schema.js

/**
 * Escape HTML
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
