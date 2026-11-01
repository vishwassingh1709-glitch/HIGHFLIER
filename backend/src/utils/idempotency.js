import { ApiError } from './ApiError.js';

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

export const normalizeIdempotencyKey = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const key = String(value).trim();
  if (!KEY_PATTERN.test(key)) {
    throw ApiError.badRequest(
      'Idempotency key must be 8-128 characters using letters, numbers, dot, colon, underscore or hyphen'
    );
  }
  return key;
};

export const normalizeOptionalString = (value) => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
};
