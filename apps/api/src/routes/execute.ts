import prisma from "@repo/db";
import type { Response } from "express";
import { Router } from "express";

import { type AuthenticatedRequest, validateToken } from "../middleware/validateToken.js";
import { executeCode } from "../services/execution.js";

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

    if (result.status.id === 3) {
      res.status(200).json({
        type: "execution-result",
        roomId,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        time: result.time ?? "",
        memory: String(result.memory ?? ""),
        status: result.status.description,
      });
      return;
    }

    res.status(200).json({
      type: "execution-error",
      roomId,
      message:
        result.compile_output ??
        result.stderr ??
        result.message ??
        result.status.description ??
        "Execution failed",
      status: result.status.description,
    });
  } catch (error) {
    res.status(502).json({
      error: "Code execution failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export { router as executeRouter };
