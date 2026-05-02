import jwt from "jsonwebtoken";
import type { Duplex } from "node:stream";

import type { AccessTokenPayload } from "./types.js";

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  throw new Error("JWT_SECRET is required");
}

export const rejectUpgrade = (socket: Duplex, code: number, message: string) => {
  const response =
    `HTTP/1.1 ${code} ${message}\r\n` +
    "Connection: close\r\n" +
    "Content-Type: text/plain\r\n" +
    `Content-Length: ${Buffer.byteLength(message)}\r\n` +
    "\r\n" +
    message;

  socket.write(response);
  socket.destroy();
};

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const payload = jwt.verify(token, jwtSecret) as AccessTokenPayload;

  if (!payload?.sub || !payload?.email) {
    throw new Error("Invalid access token payload");
  }

  return payload;
};
