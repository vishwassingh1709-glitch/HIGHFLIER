import mongoose from 'mongoose';
import multer from 'multer';
import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';
import { ERROR_CODES } from '../constants/errorCodes.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { SupplierAdapterError } from '../modules/suppliers/adapters/errors.js';

const formatZodIssues = (error) =>
  error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code
  }));

const normalizeError = (error) => {
  if (error instanceof ApiError) return error;

  if (error instanceof ZodError) {
    return new ApiError(422, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', formatZodIssues(error));
  }

  if (error instanceof mongoose.Error.ValidationError) {
    return new ApiError(
      422,
      ERROR_CODES.VALIDATION_ERROR,
      'Database validation failed',
      Object.values(error.errors).map((item) => ({ path: item.path, message: item.message }))
    );
  }

  if (error instanceof mongoose.Error.CastError) {
    return new ApiError(400, ERROR_CODES.VALIDATION_ERROR, `Invalid value for "${error.path}"`);
  }

  if (error?.name === 'MongoServerError' && error.code === 11000) {
    const fields = Object.keys(error.keyValue || error.keyPattern || {});
    return new ApiError(
      409,
      ERROR_CODES.DUPLICATE_RESOURCE,
      fields.length > 0 ? `A record with this ${fields.join(', ')} already exists` : 'Duplicate record',
      fields.length > 0 ? { fields } : undefined
    );
  }

  if (error instanceof SupplierAdapterError) {
    const statusCode = error.statusCode || (error.code === ERROR_CODES.SUPPLIER_UNSUPPORTED ? 409 : 502);
    return new ApiError(statusCode, error.code || ERROR_CODES.SUPPLIER_ERROR, error.message, error.details || undefined);
  }

  if (error instanceof multer.MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE' ? 'Uploaded file exceeds the size limit' : `Upload failed: ${error.code}`;
    return new ApiError(400, ERROR_CODES.VALIDATION_ERROR, message);
  }

  if (error?.type === 'entity.parse.failed') {
    return new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'Malformed JSON request body');
  }
  if (error?.type === 'entity.too.large') {
    return new ApiError(413, ERROR_CODES.VALIDATION_ERROR, 'Request body is too large');
  }

  if (['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error?.name)) {
    return ApiError.unauthorized('Access token is invalid or expired');
  }

  return new ApiError(500, ERROR_CODES.INTERNAL_ERROR, 'An unexpected error occurred');
};

export const notFoundHandler = (req, _res, next) =>
  next(new ApiError(404, ERROR_CODES.NOT_FOUND, `Route ${req.method} ${req.originalUrl} not found`));

// eslint-disable-next-line no-unused-vars
export const errorHandler = (error, req, res, _next) => {
  const normalized = normalizeError(error);
  const requestId = req.id;

  const logPayload = {
    requestId,
    method: req.method,
    url: req.originalUrl,
    statusCode: normalized.statusCode,
    code: normalized.code,
    err: error instanceof ApiError ? undefined : { message: error?.message, stack: error?.stack, name: error?.name }
  };

  if (normalized.statusCode >= 500) {
    logger.error(logPayload, 'Request failed');
  } else {
    logger.warn({ ...logPayload, message: normalized.message }, 'Request rejected');
  }

  res.status(normalized.statusCode).json({
    success: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details !== undefined && !env.isProduction ? { details: normalized.details } : {}),
      requestId
    }
  });
};
