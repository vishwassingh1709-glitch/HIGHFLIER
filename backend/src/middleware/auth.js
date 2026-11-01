import { ApiError } from '../utils/ApiError.js';
import { ERROR_CODES } from '../constants/errorCodes.js';
import { User } from '../models/User.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/http.js';

const isAccessTokenStale = (payload, user) => {
  if (!user.passwordChangedAt) return false;
  const changedAtSeconds = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
  return Number(payload.pwd || 0) !== changedAtSeconds;
};

/**
 * Verifies the Bearer access token, loads the current user (so deactivated
 * accounts lose access immediately) and attaches it to req.user.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Authentication required');
  }

  const token = header.slice(7).trim();
  if (!token) throw ApiError.unauthorized('Authentication required');

  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  if (isAccessTokenStale(payload, user)) {
    throw ApiError.unauthorized('Session is no longer valid. Please log in again.');
  }
  if (!user.isActive) {
    throw new ApiError(403, ERROR_CODES.ACCOUNT_DISABLED, 'Your account has been disabled');
  }
  if (env.REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) {
    throw new ApiError(403, ERROR_CODES.EMAIL_NOT_VERIFIED, 'Please verify your email address to continue');
  }

  req.user = user;
  req.auth = { sub: payload.sub, role: payload.role };
  next();
});

export const optionalAuth = asyncHandler(async (req, _res, next) => {
  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return next();
  try {
    const payload = verifyAccessToken(header.slice(7).trim());
    const user = await User.findById(payload.sub);
    if (user?.isActive && !isAccessTokenStale(payload, user)) req.user = user;
  } catch {
    // Public endpoints stay public even when a stale token is supplied.
  }
  return next();
});

export const authorize =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized('Authentication required'));
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to access this resource'));
    }
    return next();
  };

export const requireAdmin = [authenticate, authorize('admin')];
