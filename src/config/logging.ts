import dotenv from 'dotenv';
import pino, { Logger, LoggerOptions, LevelWithSilent } from 'pino';

dotenv.config({ quiet: true });

const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled']);
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const CONSOLE_METHODS = [
  'assert',
  'clear',
  'count',
  'countReset',
  'debug',
  'dir',
  'dirxml',
  'error',
  'group',
  'groupCollapsed',
  'groupEnd',
  'info',
  'log',
  'table',
  'time',
  'timeEnd',
  'timeLog',
  'trace',
  'warn',
] as const;

function normalizeFlag(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase();
}

export function areAppLogsDisabled(): boolean {
  const logsEnabled = normalizeFlag(process.env.APP_LOGS_ENABLED);
  const appDisableLogs = normalizeFlag(process.env.APP_DISABLE_LOGS);
  const disableLogs = normalizeFlag(process.env.DISABLE_LOGS);

  return (
    (logsEnabled !== undefined && FALSE_VALUES.has(logsEnabled)) ||
    (appDisableLogs !== undefined && TRUE_VALUES.has(appDisableLogs)) ||
    (disableLogs !== undefined && TRUE_VALUES.has(disableLogs))
  );
}

export function getAppLogLevel(): LevelWithSilent {
  if (areAppLogsDisabled()) {
    return 'silent';
  }

  return (process.env.APP_LOG_LEVEL as LevelWithSilent | undefined) || 'silent';
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return pino({ ...options, level: getAppLogLevel() });
}

function installLogSilencer(): void {
  if (!areAppLogsDisabled()) {
    return;
  }

  process.env.APP_LOG_LEVEL = 'silent';

  const noop = () => undefined;
  const writableConsole = console as unknown as Record<string, (...args: unknown[]) => void>;

  for (const method of CONSOLE_METHODS) {
    if (typeof writableConsole[method] === 'function') {
      writableConsole[method] = noop;
    }
  }
}

installLogSilencer();
