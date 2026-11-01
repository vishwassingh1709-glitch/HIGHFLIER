import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';

const ISSUER = 'highflier';
const AUDIENCE = 'highflier-api';

export const signAccessToken = (user) =>
  jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
      type: 'access',
      pwd: Math.floor(new Date(user.passwordChangedAt || 0).getTime() / 1000)
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_TTL, issuer: ISSUER, audience: AUDIENCE }
  );

export const signRefreshToken = (user, sessionId) =>
  jwt.sign(
    { sub: String(user._id), sid: String(sessionId), type: 'refresh', jti: crypto.randomUUID() },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_TTL, issuer: ISSUER, audience: AUDIENCE }
  );

export const verifyAccessToken = (token) => {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: ISSUER, audience: AUDIENCE });
    if (payload.type !== 'access') throw new Error('Invalid token type');
    return payload;
  } catch {
    throw ApiError.unauthorized('Access token is invalid or expired');
  }
};

export const verifyRefreshToken = (token) => {
  try {
    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET, { issuer: ISSUER, audience: AUDIENCE });
    if (payload.type !== 'refresh' || !payload.sid) throw new Error('Invalid token type');
    return payload;
  } catch {
    throw ApiError.unauthorized('Refresh token is invalid or expired');
  }
};

export const decodeTokenExpiry = (token) => {
  const decoded = jwt.decode(token);
  return decoded?.exp ? new Date(decoded.exp * 1000) : null;
};
