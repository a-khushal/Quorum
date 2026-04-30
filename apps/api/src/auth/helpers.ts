import bcrypt from "bcrypt";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

import { env } from "../config/env.js";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "7d";
const SALT_ROUNDS = 12;

export type AccessTokenPayload = {
  sub: string;
  email: string;
};

export type RefreshTokenPayload = {
  sub: string;
  family: string;
  jti: string;
};

export const hashPassword = async (value: string) => {
  return bcrypt.hash(value, SALT_ROUNDS);
};

export const comparePassword = async (plainText: string, hash: string) => {
  return bcrypt.compare(plainText, hash);
};

export const signAccessToken = (payload: AccessTokenPayload) => {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: ACCESS_TOKEN_TTL });
};

export const signRefreshToken = (payload: RefreshTokenPayload) => {
  return jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: REFRESH_TOKEN_TTL });
};

export const verifyAccessToken = (token: string) => {
  return jwt.verify(token, env.jwtSecret) as AccessTokenPayload;
};

export const verifyRefreshToken = (token: string) => {
  return jwt.verify(token, env.jwtRefreshSecret) as RefreshTokenPayload;
};

export const hashToken = (token: string) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

export const generateTokenId = () => {
  return crypto.randomUUID();
};
