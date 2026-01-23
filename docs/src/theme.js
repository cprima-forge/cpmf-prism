/**
 * Theme Switcher for rpax prism
 */

import { createLogger } from './logger.js';
import { getTheme, setTheme, subscribe } from './state.js';

const log = createLogger('theme');

const THEMES = {
  'solarized-light': 'Solarized Light',
  'solarized-dark': 'Solarized Dark',
  'work': 'Work'
};

let themeStylesheet = null;
let themeSwitcher = null;

/**
 * Initialize theme system
 */
export function initTheme() {
  log.info('Initializing theme system');

  themeStylesheet = document.getElementById('theme-stylesheet');
  themeSwitcher = document.getElementById('theme-switcher');

  if (!themeStylesheet) {
    log.error('Theme stylesheet element not found');
    return;
  }

  // Apply saved theme
  const savedTheme = getTheme();
  applyTheme(savedTheme);

  // Setup switcher if present
  if (themeSwitcher) {
    setupSwitcher();
  }

  // Subscribe to state changes
  subscribe((changeType, data) => {
    if (changeType === 'themeChanged') {
      applyTheme(data.theme);
    }
  });

  log.info('Theme system initialized', { currentTheme: savedTheme });
}

/**
 * Apply a theme
 */
function applyTheme(themeName) {
  log.debug('Applying theme', { theme: themeName });

  if (!THEMES[themeName]) {
    log.warn('Unknown theme, falling back to solarized-light', { theme: themeName });
    themeName = 'solarized-light';
  }

  const href = `assets/themes/${themeName}.css`;
  themeStylesheet.href = href;

  // Update switcher value
  if (themeSwitcher) {
    themeSwitcher.value = themeName;
  }

  log.info('Theme applied', { theme: themeName, href });
}

/**
 * Setup theme switcher dropdown
 */
function setupSwitcher() {
  log.debug('Setting up theme switcher');

  // Populate options
  themeSwitcher.innerHTML = '';
  for (const [value, label] of Object.entries(THEMES)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    themeSwitcher.appendChild(option);
  }

  // Set current value
  themeSwitcher.value = getTheme();

  // Handle change
  themeSwitcher.addEventListener('change', (e) => {
    log.info('Theme switcher changed', { theme: e.target.value });
    setTheme(e.target.value);
  });
}

/**
 * Get available themes
 */
export function getAvailableThemes() {
  return { ...THEMES };
}
