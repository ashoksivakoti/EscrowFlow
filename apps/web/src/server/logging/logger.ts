type LogContext = Record<string, unknown> | undefined;

export type AppLogger = {
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
};

export function createLogger(scope: string, requestId?: string): AppLogger {
  const base = requestId ? { scope, requestId } : { scope };
  return {
    info: (message, context) => {
      console.info(message, context ? { ...base, ...context } : base);
    },
    warn: (message, context) => {
      console.warn(message, context ? { ...base, ...context } : base);
    },
    error: (message, context) => {
      console.error(message, context ? { ...base, ...context } : base);
    },
  };
}
