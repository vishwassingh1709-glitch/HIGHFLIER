import { asyncHandler, sendSuccess } from '../../utils/http.js';
import * as usersService from './users.service.js';

export const getProfile = asyncHandler(async (req, res) => {
  sendSuccess(res, { user: req.user });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await usersService.updateProfile(req.user._id, req.body);
  sendSuccess(res, { user });
});

export const changePassword = asyncHandler(async (req, res) => {
  const result = await usersService.changePassword(req.user._id, req.body.currentPassword, req.body.newPassword);
  sendSuccess(res, result);
});

export const listAddresses = asyncHandler(async (req, res) => {
  const addresses = await usersService.listAddresses(req.user._id);
  sendSuccess(res, { addresses });
});

export const addAddress = asyncHandler(async (req, res) => {
  const addresses = await usersService.addAddress(req.user._id, req.body);
  sendSuccess(res, { addresses }, { status: 201 });
});

export const updateAddress = asyncHandler(async (req, res) => {
  const addresses = await usersService.updateAddress(req.user._id, req.params.addressId, req.body);
  sendSuccess(res, { addresses });
});

export const deleteAddress = asyncHandler(async (req, res) => {
  const addresses = await usersService.deleteAddress(req.user._id, req.params.addressId);
  sendSuccess(res, { addresses });
});

export const setDefaultAddress = asyncHandler(async (req, res) => {
  const addresses = await usersService.setDefaultAddress(req.user._id, req.params.addressId);
  sendSuccess(res, { addresses });
});
