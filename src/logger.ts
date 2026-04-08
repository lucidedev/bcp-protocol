/**
 * BCP structured logger — configurable, transport-agnostic logging for the protocol.
 *
 * Consumers can set the global log level and provide a custom transport
 * to route protocol logs into their own observability stack.
 *
 * @module logger
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

export interface LogEntry {
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  module: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

/** Implement this to pipe BCP logs into any backend. */
export interface LogTransport {
  log(entry: LogEntry): void;
}

/** Default transport — writes structured lines to stderr. */
class StderrTransport implements LogTransport {
  log(entry: LogEntry): void {
    const line = `[${entry.timestamp}] ${entry.level.padEnd(5)} [${entry.module}] ${entry.message}`;
    if (entry.data && Object.keys(entry.data).length > 0) {
      process.stderr.write(line + ' ' + JSON.stringify(entry.data) + '\n');
    } else {
      process.stderr.write(line + '\n');
    }
  }
}

let globalLevel: LogLevel = LogLevel.INFO;
let globalTransport: LogTransport = new StderrTransport();

/**
 * Configure the global BCP logger.
 *
 * Call once at application startup:
 * ```ts
 * import { configureLogger, LogLevel } from 'bcp-protocol';
 * configureLogger({ level: LogLevel.DEBUG });
 * ```
 */
export function configureLogger(opts: {
  level?: LogLevel;
  transport?: LogTransport;
}): void {
  if (opts.level !== undefined) globalLevel = opts.level;
  if (opts.transport) globalTransport = opts.transport;
}

/** Per-module logger instance. */
export class Logger {
  constructor(private module: string) {}

  debug(message: string, data?: Record<string, unknown>): void {
    if (globalLevel <= LogLevel.DEBUG) {
      globalTransport.log({ level: 'DEBUG', module: this.module, message, data, timestamp: new Date().toISOString() });
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (globalLevel <= LogLevel.INFO) {
      globalTransport.log({ level: 'INFO', module: this.module, message, data, timestamp: new Date().toISOString() });
    }
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (globalLevel <= LogLevel.WARN) {
      globalTransport.log({ level: 'WARN', module: this.module, message, data, timestamp: new Date().toISOString() });
    }
  }

  error(message: string, data?: Record<string, unknown>): void {
    if (globalLevel <= LogLevel.ERROR) {
      globalTransport.log({ level: 'ERROR', module: this.module, message, data, timestamp: new Date().toISOString() });
    }
  }
}

/** Create a logger scoped to a protocol module. */
export function createLogger(module: string): Logger {
  return new Logger(module);
}
