import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

const ROUNDS = env.isTest ? 8 : 12;

export const hashPassword = (plainPassword) => bcrypt.hash(plainPassword, ROUNDS);

export const verifyPassword = (plainPassword, passwordHash) => {
  if (!passwordHash) return false;
  return bcrypt.compare(plainPassword, passwordHash);
};
