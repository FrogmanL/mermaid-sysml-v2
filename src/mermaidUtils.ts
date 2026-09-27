/**
 * Mermaid injects its internal logger/config/sanitizer/viewbox helpers into
 * external diagrams via `injectUtils` rather than letting them import from
 * the `mermaid` package directly. This module holds the injected references
 * so the rest of the plugin can use them like any other import.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const warnBeforeInit = (name: string) => (...args: unknown[]) => {
  // eslint-disable-next-line no-console
  console.warn(`[mermaid-sysml-v2] "${name}" called before mermaid injected its utils`, ...args);
};

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export const log: Record<LogLevel, (...args: unknown[]) => void> = {
  trace: warnBeforeInit('trace'),
  debug: warnBeforeInit('debug'),
  info: warnBeforeInit('info'),
  warn: warnBeforeInit('warn'),
  error: warnBeforeInit('error'),
  fatal: warnBeforeInit('fatal'),
};

export let getConfig: () => any = () => ({});
export let sanitizeText: (str: string) => string = (str) => str;
export let setupGraphViewbox: (
  graph: any,
  svgElem: any,
  padding: number,
  useMaxWidth: boolean
) => void = () => {
  /* no-op until injected */
};
export let commonDb: () => any = () => ({});

export const injectUtils = (
  _log: Record<LogLevel, (...args: unknown[]) => void>,
  _setLogLevel: any,
  _getConfig: any,
  _sanitizeText: any,
  _setupGraphViewbox: any,
  _commonDb: any
): void => {
  log.trace = _log.trace;
  log.debug = _log.debug;
  log.info = _log.info;
  log.warn = _log.warn;
  log.error = _log.error;
  log.fatal = _log.fatal;
  getConfig = _getConfig;
  sanitizeText = _sanitizeText;
  setupGraphViewbox = _setupGraphViewbox;
  commonDb = _commonDb;
};
