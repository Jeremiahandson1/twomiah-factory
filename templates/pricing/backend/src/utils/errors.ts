import { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger } from '../services/logger';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    isOperational: boolean = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ValidationError extends AppError {
  constructor(message: string = 'Validation failed') {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Not authenticated') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
  }
}

export const errorHandler = (err: Error, c: Context) => {
  if (err instanceof AppError) {
    logger.warn(`AppError: ${err.code} - ${err.message}`, {
      statusCode: err.statusCode,
      code: err.code,
      path: c.req.path,
      method: c.req.method,
    });
    return c.json(
      {
        error: err.message,
        code: err.code,
      },
      err.statusCode as any
    );
  }

  if (err instanceof HTTPException) {
    logger.warn(`HTTPException: ${err.status} - ${err.message}`, {
      status: err.status,
      path: c.req.path,
      method: c.req.method,
    });
    return c.json(
      {
        error: err.message,
        code: 'HTTP_ERROR',
      },
      err.status
    );
  }

  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: c.req.path,
    method: c.req.method,
  });

  return c.json(
    {
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    },
    500
  );
};

export const handleUncaughtExceptions = () => {
  process.on('uncaughtException', (err: Error) => {
    logger.error('Uncaught Exception', {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: any) => {
    logger.error('Unhandled Rejection', {
      reason: reason?.message || String(reason),
      stack: reason?.stack,
    });
  });
};
