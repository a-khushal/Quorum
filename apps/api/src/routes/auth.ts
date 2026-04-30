import prisma from "@repo/db";
import type { Request, Response } from "express";
import { Router } from "express";

import {
  comparePassword,
  generateTokenId,
  hashPassword,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../auth/helpers.js";

const REFRESH_COOKIE_NAME = "refreshToken";

const refreshCookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/auth",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const router: Router = Router();

const getString = (value: unknown) => {
  return typeof value === "string" ? value.trim() : "";
};

router.post("/register", async (req: Request, res: Response) => {
  const email = getString(req.body?.email).toLowerCase();
  const password = getString(req.body?.password);

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    res.status(409).json({ error: "User already exists" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, passwordHash },
    select: { id: true, email: true, createdAt: true },
  });

  res.status(201).json({ user });
});

router.post("/login", async (req: Request, res: Response) => {
  const email = getString(req.body?.email).toLowerCase();
  const password = getString(req.body?.password);

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const isPasswordValid = await comparePassword(password, user.passwordHash);
  if (!isPasswordValid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const family = generateTokenId();
  const jti = generateTokenId();
  const accessToken = signAccessToken({ sub: user.id, email: user.email });
  const refreshToken = signRefreshToken({ sub: user.id, family, jti });

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      family,
      expiresAt: new Date(Date.now() + refreshCookieOptions.maxAge),
    },
  });

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);
  res.status(200).json({ accessToken });
});

router.post("/refresh", async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;

  if (!refreshToken) {
    res.status(401).json({ error: "Missing refresh token" });
    return;
  }

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions);
    res.status(401).json({ error: "Invalid refresh token" });
    return;
  }

  const currentTokenHash = hashToken(refreshToken);
  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash: currentTokenHash },
  });

  if (!storedToken || storedToken.used || storedToken.expiresAt.getTime() < Date.now()) {
    await prisma.refreshToken.deleteMany({
      where: {
        userId: payload.sub,
        family: payload.family,
      },
    });
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions);
    res.status(401).json({ error: "Refresh token rejected" });
    return;
  }

  const newJti = generateTokenId();
  const newRefreshToken = signRefreshToken({
    sub: payload.sub,
    family: payload.family,
    jti: newJti,
  });

  const newRefreshTokenHash = hashToken(newRefreshToken);

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { used: true },
    }),
    prisma.refreshToken.create({
      data: {
        userId: payload.sub,
        tokenHash: newRefreshTokenHash,
        family: payload.family,
        expiresAt: new Date(Date.now() + refreshCookieOptions.maxAge),
      },
    }),
  ]);

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true },
  });

  if (!user) {
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions);
    res.status(401).json({ error: "User not found" });
    return;
  }

  const accessToken = signAccessToken({ sub: user.id, email: user.email });

  res.cookie(REFRESH_COOKIE_NAME, newRefreshToken, refreshCookieOptions);
  res.status(200).json({ accessToken });
});

router.post("/logout", async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;

  if (refreshToken) {
    await prisma.refreshToken.deleteMany({
      where: { tokenHash: hashToken(refreshToken) },
    });
  }

  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions);
  res.status(200).json({ success: true });
});

export { router as authRouter };
