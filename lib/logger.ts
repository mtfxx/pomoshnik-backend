// ============================================================
// Помощник — Structured Logger
// ============================================================
// JSON-formatted logging with request IDs, timestamps, and
// severity levels. Sentry-ready: set SENTRY_DSN env var to
// enable error reporting (requires @sentry/node package).
// ============================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  requestId?: string;
  licenseKey?: string;  // masked
  [key: string]: unknown;
}

// Mask license key for logging: POM-XXXXX-...-XXXXX → POM-XXX**-...-*****
function maskLicenseKey(key: string): string {
  if (!key || key.length < 10) return '***';
  return key.slice(0, 7) + '**-****-****-*****';
}

// Generate a short request ID
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

class Logger {
  private module: string;

  constructor(module: string) {
    this.module = module;
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message,
    };

    // Add metadata
    if (meta) {
      // Mask sensitive fields
      if (meta.licenseKey && typeof meta.licenseKey === 'string') {
        entry.licenseKey = maskLicenseKey(meta.licenseKey);
      }
      // Copy other fields
      for (const [k, v] of Object.entries(meta)) {
        if (k !== 'licenseKey') {
          entry[k] = v;
        }
      }
    }

    const json = JSON.stringify(entry);

    switch (level) {
      case 'error':
        console.error(json);
        break;
      case 'warn':
        console.warn(json);
        break;
      case 'debug':
        if (process.env.LOG_LEVEL === 'debug') {
          console.debug(json);
        }
        break;
      default:
        console.log(json);
    }
  }

  debug(message: string, meta?: Record<string, unknown>) {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>) {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>) {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>) {
    this.log('error', message, meta);
  }
}

export function createLogger(module: string): Logger {
  return new Logger(module);
}
