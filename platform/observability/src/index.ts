import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import pino from 'pino';
import { ensureCorrelationId } from '@platform/shared';

export const initOtel = (logLevel: DiagLogLevel = DiagLogLevel.ERROR): void => {
  diag.setLogger(new DiagConsoleLogger(), logLevel);
  // Place OTLP exporter + SDK initialization here when wiring a vendor.
};

const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        }
      : undefined,
});

export const logger = {
  child: (bindings?: Record<string, unknown>) => baseLogger.child(bindings ?? {}),
  info: (msg: string, meta?: Record<string, unknown>) => baseLogger.info(meta, msg),
  warn: (msg: string, meta?: Record<string, unknown>) => baseLogger.warn(meta, msg),
  error: (msg: string, meta?: Record<string, unknown>) => baseLogger.error(meta, msg),
};

export const withCorrelationId = (headers: Record<string, string | string[] | undefined>) => {
  const correlationId = ensureCorrelationId(headers['x-correlation-id']);
  return {
    correlationId,
    logger: logger.child({ correlationId }),
  };
};

