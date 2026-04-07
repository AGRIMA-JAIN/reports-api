// src/middleware/errorHandler.ts

import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { ApiError } from '../types';

// Must have 4 parameters to be recognised as Express error middleware
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error('app_error', {
        code: err.code,
        message: err.message,
        stack: err.stack,
        requestId: req.requestId,
      });
    } else {
      logger.warn('client_error', {
        code: err.code,
        message: err.message,
        statusCode: err.statusCode,
        requestId: req.requestId,
      });
    }

    const body: ApiError = {
      code: err.code,
      message: err.message,
      details: err.details,
      requestId: req.requestId,
    };
    res.status(err.statusCode).json({ error: body });
    return;
  }

  // Unhandled / unexpected errors
  logger.error('unhandled_error', {
    message: err.message,
    stack: err.stack,
    requestId: req.requestId,
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
      requestId: req.requestId,
    } as ApiError,
  });
}
