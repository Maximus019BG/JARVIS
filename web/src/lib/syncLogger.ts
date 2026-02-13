export type SyncLoggerLevel = "debug" | "info" | "warn" | "error";

export interface SyncLogger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

function write(level: SyncLoggerLevel, message: string, meta?: Record<string, unknown>) {
  // Keep logs JSON-ish and safe to parse, without throwing on circular structures.
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  };

  const line = (() => {
    try {
      return JSON.stringify(payload);
    } catch {
      // Fall back to a minimal log line.
      return JSON.stringify({ ts: payload.ts, level, message });
    }
  })();

  // Route to the appropriate console method.
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "info") console.info(line);
  else console.debug(line);
}

/**
 * Minimal sync logger for server routes.
 *
 * You can pass `meta` with primitive values/objects; it will be serialized.
 */
export const syncLogger: SyncLogger = {
  debug: (message, meta) => write("debug", message, meta),
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
};
