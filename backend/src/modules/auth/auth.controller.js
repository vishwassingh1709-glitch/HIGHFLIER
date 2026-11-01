import { asyncHandler, sendCreated, sendSuccess } from '../../utils/http.js';
import * as authService from './auth.service.js';

export const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, req);
  sendCreated(res, result);
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, req);
  sendSuccess(res, result);
});

export const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refreshTokenPair(req.body.refreshToken, req);
  sendSuccess(res, result);
});

export const logout = asyncHandler(async (req, res) => {
  const result = await authService.logout(req.user, req.body);
  sendSuccess(res, result);
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.user._id);
  sendSuccess(res, { user });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.forgotPassword(req.body.email);
  sendSuccess(res, result);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const result = await authService.resetPassword(req.body);
  sendSuccess(res, result);
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const result = await authService.verifyEmail(req.query.token);
  sendSuccess(res, result);
});

export const resendVerification = asyncHandler(async (req, res) => {
  const result = await authService.resendVerification(req.body.email);
  sendSuccess(res, result);
});
