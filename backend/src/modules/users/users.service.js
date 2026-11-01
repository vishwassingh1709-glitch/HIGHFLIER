import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { User } from '../../models/User.js';
import * as authService from '../auth/auth.service.js';

const MAX_ADDRESSES = 10;

const getUserOrThrow = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User');
  return user;
};

export const updateProfile = async (userId, data) => {
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: data },
    { new: true, runValidators: true }
  );
  if (!user) throw ApiError.notFound('User');
  return user;
};

export const listAddresses = async (userId) => {
  const user = await getUserOrThrow(userId);
  return user.addresses;
};

export const addAddress = async (userId, payload) => {
  const user = await getUserOrThrow(userId);
  if (user.addresses.length >= MAX_ADDRESSES) {
    throw ApiError.badRequest(`A maximum of ${MAX_ADDRESSES} addresses is allowed`);
  }

  const shouldBeDefault = payload.isDefault === true || user.addresses.length === 0;
  if (shouldBeDefault) {
    user.addresses.forEach((address) => {
      address.isDefault = false;
    });
  }

  user.addresses.push({ ...payload, isDefault: shouldBeDefault });
  await user.save();
  return user.addresses;
};

export const updateAddress = async (userId, addressId, payload) => {
  const user = await getUserOrThrow(userId);
  const address = user.addresses.id(addressId);
  if (!address) throw ApiError.notFound('Address');

  if (payload.isDefault === true) {
    user.addresses.forEach((item) => {
      item.isDefault = false;
    });
  }

  Object.assign(address, payload);

  if (!user.addresses.some((item) => item.isDefault)) {
    user.addresses[0].isDefault = true;
  }

  await user.save();
  return user.addresses;
};

export const deleteAddress = async (userId, addressId) => {
  const user = await getUserOrThrow(userId);
  const address = user.addresses.id(addressId);
  if (!address) throw ApiError.notFound('Address');

  const wasDefault = address.isDefault;
  address.deleteOne();

  if (wasDefault && user.addresses.length > 0) {
    user.addresses[0].isDefault = true;
  }

  await user.save();
  return user.addresses;
};

export const setDefaultAddress = async (userId, addressId) => {
  if (!mongoose.Types.ObjectId.isValid(addressId)) throw ApiError.notFound('Address');
  const user = await getUserOrThrow(userId);
  const address = user.addresses.id(addressId);
  if (!address) throw ApiError.notFound('Address');

  user.addresses.forEach((item) => {
    item.isDefault = String(item._id) === String(addressId);
  });
  await user.save();
  return user.addresses;
};

export const changePassword = async (userId, currentPassword, newPassword) =>
  authService.changePassword(userId, currentPassword, newPassword);
