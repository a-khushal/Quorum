import prisma from "@repo/db";
import type { Response } from "express";
import { Router } from "express";

import { type AuthenticatedRequest, validateToken } from "../middleware/validateToken.js";
import { executeCode } from "../services/execution.js";
import { publishExecutionEvent } from "../services/executionRelay.js";

const router: Router = Router();
const allowedLanguages = ["TYPESCRIPT", "PYTHON", "JAVA", "GO", "CPP", "C"] as const;
type RoomLanguage = (typeof allowedLanguages)[number];

const isRoomLanguage = (value: string): value is RoomLanguage => {
  return allowedLanguages.includes(value as RoomLanguage);
};

const parseRoomLanguage = (value: unknown): RoomLanguage | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return undefined;
  }

  return isRoomLanguage(normalized) ? normalized : undefined;
};

const getString = (value: unknown) => {
  return typeof value === "string" ? value.trim() : "";
};

const getAccessToken = (req: AuthenticatedRequest) => {
  const authHeader = req.headers.authorization;
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
};

router.use(validateToken);

router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user?.id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const roomId = getString(req.body?.roomId);
  const sourceCode = getString(req.body?.sourceCode);
  const language = parseRoomLanguage(req.body?.language);

  if (!roomId) {
    res.status(400).json({ error: "roomId is required" });
    return;
  }

  if (!sourceCode) {
    res.status(400).json({ error: "sourceCode is required" });
    return;
  }

  if (!language) {
    res.status(400).json({
      error: "Unsupported language",
      allowedLanguages,
    });
    return;
  }

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, createdBy: true, status: true, language: true },
  });

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  if (room.createdBy !== req.user.id) {
    res.status(403).json({ error: "Only room creator can execute code" });
    return;
  }

  try {
    const result = await executeCode(sourceCode, language);
    const accessToken = getAccessToken(req);

    if (result.status.id === 3) {
      const payload = {
        type: "execution-result",
        roomId,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        time: result.time ?? "",
        memory: String(result.memory ?? ""),
        status: result.status.description,
      } as const;

      try {
        await publishExecutionEvent(roomId, accessToken, payload);
      } catch (relayError) {
        console.error("execution relay publish failed", {
          roomId,
          type: payload.type,
          error: relayError instanceof Error ? relayError.message : "Unknown error",
        });
      }

      res.status(200).json(payload);
      return;
    }

    const payload = {
      type: "execution-error",
      roomId,
      message:
        result.compile_output ??
        result.stderr ??
        result.message ??
        result.status.description ??
        "Execution failed",
      status: result.status.description,
    } as const;

    try {
      await publishExecutionEvent(roomId, accessToken, payload);
    } catch (relayError) {
      console.error("execution relay publish failed", {
        roomId,
        type: payload.type,
        error: relayError instanceof Error ? relayError.message : "Unknown error",
      });
    }

    res.status(200).json(payload);
  } catch (error) {
    const accessToken = getAccessToken(req);
    const payload = {
      type: "execution-error",
      roomId,
      message: error instanceof Error ? error.message : "Unknown error",
      status: "Execution Failed",
    } as const;

    try {
      await publishExecutionEvent(roomId, accessToken, payload);
    } catch (relayError) {
      console.error("execution relay publish failed", {
        roomId,
        type: payload.type,
        error: relayError instanceof Error ? relayError.message : "Unknown error",
      });
    }

    res.status(502).json({
      error: "Code execution failed",
      message: payload.message,
    });
  }
});

export { router as executeRouter };
