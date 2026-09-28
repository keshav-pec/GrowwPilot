import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

// 8 random characters, shown once to whoever creates the account
export function generateTempPassword() {
  return crypto.randomBytes(6).toString('base64url');
}

export function hashPassword(password) {
  return bcrypt.hash(password, 10);
}
