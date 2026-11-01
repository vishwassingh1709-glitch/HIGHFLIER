import { ERROR_CODES } from '../constants/errorCodes.js';

export class ApiError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'Bad request', details) {
    return new ApiError(400, ERROR_CODES.VALIDATION_ERROR, message, details);
  }

  static unauthorized(message = 'Authentication required', code = ERROR_CODES.UNAUTHORIZED) {
    return new ApiError(401, code, message);
  }

  static invalidCredentials(message = 'Invalid email or password') {
    return new ApiError(401, ERROR_CODES.INVALID_CREDENTIALS, message);
  }

  static forbidden(message = 'You do not have permission to perform this action') {
    return new ApiError(403, ERROR_CODES.FORBIDDEN, message);
  }

  static notFound(resource = 'Resource') {
    return new ApiError(404, ERROR_CODES.NOT_FOUND, `${resource} not found`);
  }

  static conflict(message = 'Resource already exists', code = ERROR_CODES.CONFLICT) {
    return new ApiError(409, code, message);
  }

  static unprocessable(message = 'Validation failed', details) {
    return new ApiError(422, ERROR_CODES.VALIDATION_ERROR, message, details);
  }

  static tooManyRequests(message = 'Too many requests, please try again later') {
    return new ApiError(429, ERROR_CODES.RATE_LIMITED, message);
  }

  static internal(message = 'An unexpected error occurred') {
    return new ApiError(500, ERROR_CODES.INTERNAL_ERROR, message);
  }

  static serviceUnavailable(message = 'Service temporarily unavailable', code = ERROR_CODES.SERVICE_UNAVAILABLE) {
    return new ApiError(503, code, message);
  }
}
