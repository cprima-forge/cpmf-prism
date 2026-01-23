/**
 * Logger module for rpax prism
 * Provides structured logging with levels and context
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

// Configure minimum log level (can be changed for debugging)
let minLevel = LOG_LEVELS.DEBUG;

// Log history for debugging
const logHistory = [];
const MAX_HISTORY = 500;

/**
 * Format a log entry with timestamp and context
 */
function formatEntry(level, module, message, data) {
  return {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    data: data !== undefined ? data : null
  };
}

/**
 * Store entry in history
 */
function storeEntry(entry) {
  logHistory.push(entry);
  if (logHistory.length > MAX_HISTORY) {
    logHistory.shift();
  }
}

/**
 * Output to console with appropriate styling
 */
function output(entry) {
  const prefix = `[${entry.timestamp.slice(11, 23)}] [${entry.module}]`;
  const styles = {
    DEBUG: 'color: #6b7280',
    INFO: 'color: #2563eb',
    WARN: 'color: #d97706; font-weight: bold',
    ERROR: 'color: #dc2626; font-weight: bold'
  };

  const args = [`%c${prefix} ${entry.message}`, styles[entry.level]];
  if (entry.data !== null) {
    args.push(entry.data);
  }

  switch (entry.level) {
    case 'DEBUG':
      console.debug(...args);
      break;
    case 'INFO':
      console.info(...args);
      break;
    case 'WARN':
      console.warn(...args);
      break;
    case 'ERROR':
      console.error(...args);
      break;
  }
}

/**
 * Create a logger instance for a specific module
 */
export function createLogger(moduleName) {
  const log = (level, message, data) => {
    if (LOG_LEVELS[level] < minLevel) return;

    const entry = formatEntry(level, moduleName, message, data);
    storeEntry(entry);
    output(entry);
  };

  return {
    debug: (message, data) => log('DEBUG', message, data),
    info: (message, data) => log('INFO', message, data),
    warn: (message, data) => log('WARN', message, data),
    error: (message, data) => log('ERROR', message, data),

    // Group related logs
    group: (label) => {
      console.group(`[${moduleName}] ${label}`);
    },
    groupEnd: () => {
      console.groupEnd();
    },

    // Time operations
    time: (label) => {
      console.time(`[${moduleName}] ${label}`);
    },
    timeEnd: (label) => {
      console.timeEnd(`[${moduleName}] ${label}`);
    }
  };
}

/**
 * Set minimum log level
 */
export function setLogLevel(level) {
  if (LOG_LEVELS[level] !== undefined) {
    minLevel = LOG_LEVELS[level];
  }
}

/**
 * Get log history (for debugging)
 */
export function getLogHistory() {
  return [...logHistory];
}

/**
 * Export log history as JSON (for debugging)
 */
export function exportLogs() {
  return JSON.stringify(logHistory, null, 2);
}

/**
 * Clear log history
 */
export function clearLogs() {
  logHistory.length = 0;
}

// Expose to window for console debugging
if (typeof window !== 'undefined') {
  window.prismLogs = {
    getHistory: getLogHistory,
    export: exportLogs,
    clear: clearLogs,
    setLevel: setLogLevel
  };
}
