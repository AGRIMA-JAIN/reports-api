// src/utils/errors.ts

import { FieldError } from '../types';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: FieldError[]
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(404, 'NOT_FOUND', `${resource} with id '${id}' was not found.`);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: FieldError[]) {
    super(409, 'CONFLICT', message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details: FieldError[]) {
    super(422, 'VALIDATION_ERROR', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required.') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(403, 'FORBIDDEN', message);
  }
}

export class PreconditionFailedError extends AppError {
  constructor(message: string) {
    super(412, 'PRECONDITION_FAILED', message);
  }
}

export class TooLargeError extends AppError {
  constructor(message: string) {
    super(413, 'PAYLOAD_TOO_LARGE', message);
  }
}

export class UnsupportedMediaError extends AppError {
  constructor(message: string) {
    super(415, 'UNSUPPORTED_MEDIA_TYPE', message);
  }
}
