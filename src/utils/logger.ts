export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export class ConsoleLogger implements Logger {
  info(message: string, meta?: Record<string, unknown>): void {
    console.info(formatLog("info", message, meta));
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(formatLog("warn", message, meta));
  }

  error(message: string, meta?: Record<string, unknown>): void {
    console.error(formatLog("error", message, meta));
  }
}

function formatLog(level: string, message: string, meta?: Record<string, unknown>): string {
  return JSON.stringify({
    level,
    message,
    meta,
    at: new Date().toISOString(),
  });
}
