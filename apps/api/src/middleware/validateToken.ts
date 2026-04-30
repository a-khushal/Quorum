import type { NextFunction, Request, Response } from "express";

import { verifyAccessToken } from "../auth/helpers.js";

export type AuthenticatedRequest = Request & {
  user?: {
    id: string;
    email: string;
  };
};

export const validateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!token) {
    res.status(401).json({ error: "Missing access token" });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired access token" });
  }
};
