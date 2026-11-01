import { env } from '../../config/env.js';
import { ERROR_CODES } from '../../constants/errorCodes.js';
import { ROLES } from '../../constants/roles.js';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../utils/ApiError.js';
import { sha256, randomToken } from '../../utils/crypto.js';
import { decodeTokenExpiry, signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { Session } from '../../models/Session.js';
import { User } from '../../models/User.js';
import { VerificationToken } from '../../models/VerificationToken.js';
import { sendPasswordResetEmail, sendVerificationEmail } from './mailer.service.js';

const buildTokenPayload = (user, refreshToken, session) => ({
  accessToken: signAccessToken(user),
  refreshToken,
  tokenType: 'Bearer',
  accessTokenExpiresIn: env.JWT_ACCESS_TTL,
  refreshTokenExpiresAt: session.expiresAt
});

const createSessionAndTokens = async (user, req) => {
  const session = new Session({
    user: user._id,
    refreshTokenHash: 'pending',
    userAgent: (req.get('user-agent') || '').slice(0, 300),
    ip: (req.ip || '').slice(0, 64),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  });

  const refreshToken = signRefreshToken(user, session._id);
  session.refreshTokenHash = sha256(refreshToken);
  session.expiresAt = decodeTokenExpiry(refreshToken) || session.expiresAt;
  await session.save();

  return buildTokenPayload(user, refreshToken, session);
};

const issueVerificationToken = async (user, type) => {
  const rawToken = randomToken(32);
  const ttlHours = type === 'password_reset' ? env.PASSWORD_RESET_TTL_MINUTES / 60 : env.EMAIL_VERIFICATION_TTL_HOURS;

  await VerificationToken.updateMany(
    { user: user._id, type, usedAt: null },
    { $set: { usedAt: new Date() } }
  );

  await VerificationToken.create({
    user: user._id,
    type,
    tokenHash: sha256(rawToken),
    expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000)
  });

  return rawToken;
};

const safeSend = async (sendFn, ...args) => {
  try {
    await sendFn(...args);
  } catch (error) {
    logger.error({ err: error }, 'Transactional email delivery failed');
  }
};

export const revokeAllSessions = async (userId) => {
  await Session.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
};

export const register = async ({ name, email, password, phone }, req) => {
  const existing = await User.findOne({ email });
  if (existing) {
    throw ApiError.conflict('An account with this email already exists', ERROR_CODES.DUPLICATE_RESOURCE);
  }

  const passwordHash = await hashPassword(password);
  const user = await User.create({
    name,
    email,
    passwordHash,
    phone,
    role: ROLES.CUSTOMER // public signup can never self-assign admin
  });

  const verificationToken = await issueVerificationToken(user, 'email_verification');
  await safeSend(sendVerificationEmail, user, verificationToken);

  if (env.REQUIRE_EMAIL_VERIFICATION) {
    return {
      user: user.toJSON(),
      tokens: null,
      emailVerificationRequired: true,
      message: 'Registration successful. Please verify your email before logging in.'
    };
  }

  const tokens = await createSessionAndTokens(user, req);
  return { user: user.toJSON(), tokens, emailVerificationRequired: false };
};

export const login = async ({ email, password }, req) => {
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw ApiError.invalidCredentials();
  }
  if (!user.isActive) {
    throw new ApiError(403, ERROR_CODES.ACCOUNT_DISABLED, 'Your account has been disabled');
  }
  if (env.REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) {
    throw new ApiError(403, ERROR_CODES.EMAIL_NOT_VERIFIED, 'Please verify your email address before logging in');
  }

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  const tokens = await createSessionAndTokens(user, req);
  return { user: user.toJSON(), tokens };
};

export const refreshTokenPair = async (providedRefreshToken, req) => {
  const payload = verifyRefreshToken(providedRefreshToken);
  const session = await Session.findById(payload.sid);

  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    throw ApiError.unauthorized('Session is no longer valid. Please log in again.');
  }
  if (String(session.user) !== String(payload.sub)) {
    throw ApiError.unauthorized('Session is no longer valid. Please log in again.');
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) {
    await Session.updateOne({ _id: session._id }, { $set: { revokedAt: new Date() } });
    throw ApiError.unauthorized('Account is not active');
  }

  const newRefreshToken = signRefreshToken(user, session._id);
  const newHash = sha256(newRefreshToken);
  const newExpiry = decodeTokenExpiry(newRefreshToken) || session.expiresAt;

  // Atomic rotation: a replayed (already rotated) token cannot win this update.
  const rotated = await Session.findOneAndUpdate(
    { _id: session._id, refreshTokenHash: sha256(providedRefreshToken), revokedAt: null },
    {
      $set: {
        refreshTokenHash: newHash,
        expiresAt: newExpiry,
        lastUsedAt: new Date(),
        userAgent: (req.get('user-agent') || session.userAgent || '').slice(0, 300),
        ip: (req.ip || session.ip || '').slice(0, 64)
      }
    },
    { new: true }
  );

  if (!rotated) {
    await Session.updateOne({ _id: session._id }, { $set: { revokedAt: new Date() } });
    throw ApiError.unauthorized('Refresh token reuse detected. Please log in again.');
  }

  return {
    ...buildTokenPayload(user, newRefreshToken, rotated),
    user: user.toJSON()
  };
};

export const logout = async (user, { refreshToken, allDevices } = {}) => {
  if (allDevices || !refreshToken) {
    await revokeAllSessions(user._id);
    return { message: 'Logged out from all devices' };
  }

  try {
    const payload = verifyRefreshToken(refreshToken);
    if (String(payload.sub) === String(user._id)) {
      await Session.updateOne(
        { _id: payload.sid, user: user._id, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
    }
  } catch {
    // Logout stays idempotent even with an expired/invalid refresh token.
  }

  return { message: 'Logged out successfully' };
};

export const getMe = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User');
  return user;
};

export const forgotPassword = async (email) => {
  const genericMessage = 'If an account exists for this email, a password reset link has been sent.';
  const user = await User.findOne({ email });
  if (!user || !user.isActive) return { message: genericMessage };

  const token = await issueVerificationToken(user, 'password_reset');
  await safeSend(sendPasswordResetEmail, user, token);
  return { message: genericMessage };
};

export const resetPassword = async ({ token, password }) => {
  const record = await VerificationToken.findOneAndUpdate(
    {
      tokenHash: sha256(token),
      type: 'password_reset',
      usedAt: null,
      expiresAt: { $gt: new Date() }
    },
    { $set: { usedAt: new Date() } },
    { new: true }
  );

  if (!record) throw ApiError.badRequest('Password reset link is invalid or has expired');

  const user = await User.findById(record.user);
  if (!user || !user.isActive) throw ApiError.badRequest('Password reset link is invalid or has expired');

  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = new Date();
  await user.save();
  await revokeAllSessions(user._id);

  return { message: 'Password has been reset successfully. Please log in with your new password.' };
};

export const verifyEmail = async (token) => {
  const record = await VerificationToken.findOneAndUpdate(
    {
      tokenHash: sha256(token),
      type: 'email_verification',
      usedAt: null,
      expiresAt: { $gt: new Date() }
    },
    { $set: { usedAt: new Date() } },
    { new: true }
  );

  if (!record) throw ApiError.badRequest('Verification link is invalid or has expired');

  await User.updateOne(
    { _id: record.user },
    { $set: { emailVerified: true, emailVerifiedAt: new Date() } }
  );

  return { message: 'Email verified successfully' };
};

export const resendVerification = async (email) => {
  const genericMessage = 'If the account exists and is not verified, a new verification email has been sent.';
  const user = await User.findOne({ email });
  if (!user || !user.isActive || user.emailVerified) return { message: genericMessage };

  const token = await issueVerificationToken(user, 'email_verification');
  await safeSend(sendVerificationEmail, user, token);
  return { message: genericMessage };
};

export const changePassword = async (userId, currentPassword, newPassword) => {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw ApiError.notFound('User');
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw ApiError.badRequest('Current password is incorrect');
  }
  if (currentPassword === newPassword) {
    throw ApiError.badRequest('New password must be different from the current password');
  }

  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  await user.save();
  await revokeAllSessions(user._id);

  return { message: 'Password changed successfully. Please log in again.' };
};
