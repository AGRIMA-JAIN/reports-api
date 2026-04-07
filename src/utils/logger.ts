// src/utils/logger.ts

import winston from 'winston';
import path from 'path';

const { combine, timestamp, json, colorize, simple, errors } = winston.format;

const isProduction = process.env.NODE_ENV === 'production';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    json()
  ),
  defaultMeta: { service: 'reports-api' },
  transports: [
   
    new winston.transports.Console({
      format: isProduction
        ? combine(timestamp(), json())
        : combine(colorize(), simple()),
    }),
    // Persistent file transport
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
      tailable: true,
    }),
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'combined.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10,
      tailable: true,
    }),
  ],
});

// Convenience helpers that attach a requestId for tracing
export const reqLogger = (requestId: string) => ({
  debug: (msg: string, meta?: object) => logger.debug(msg, { requestId, ...meta }),
  info:  (msg: string, meta?: object) => logger.info(msg,  { requestId, ...meta }),
  warn:  (msg: string, meta?: object) => logger.warn(msg,  { requestId, ...meta }),
  error: (msg: string, meta?: object) => logger.error(msg, { requestId, ...meta }),
});
