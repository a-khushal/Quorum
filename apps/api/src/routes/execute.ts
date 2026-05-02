import prisma from "@repo/db";
import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { Router } from "express";

import { type AuthenticatedRequest, validateToken } from "../middleware/validateToken.js";
import { executeCode, getExecutionProvider } from "../services/execution.js";
import { publishExecutionEvent, type RelayPayload } from "../services/executionRelay.js";

const router: Router = Router();
const allowedLanguages = ["TYPESCRIPT", "PYTHON", "JAVA", "GO", "CPP", "C"] as const;
const maxSourceCodeLength = 20_000;
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

const buildExecutionErrorPayload = (roomId: string, message: string, status: string, requestId: string): RelayPayload => {
  return {
    type: "execution-error",
    roomId,
    message,
    status,
    requestId,
  };
};

const publishExecutionEventBestEffort = async (payload: RelayPayload, requestId: string) => {
  try {
    await publishExecutionEvent(payload);
    console.log(
      JSON.stringify({
        event: "execute.relay.publish.success",
        requestId,
        roomId: payload.roomId,
        type: payload.type,
      }),
    );
  } catch (relayError) {
    console.error(
      JSON.stringify({
        event: "execute.relay.publish.failed",
        requestId,
        roomId: payload.roomId,
        type: payload.type,
        error: relayError instanceof Error ? relayError.message : "Unknown error",
      }),
    );
  }
};

router.use(validateToken);

router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  const requestId = randomUUID();

  if (!req.user?.id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const roomId = getString(req.body?.roomId);
  const sourceCode = getString(req.body?.sourceCode);
  const language = parseRoomLanguage(req.body?.language);
  const provider = getExecutionProvider();

  console.log(
    JSON.stringify({
      event: "execute.start",
      requestId,
      roomId,
      userId: req.user.id,
      language,
      provider,
    }),
  );

  if (!roomId) {
    res.status(400).json({ error: "roomId is required" });
    return;
  }

  if (!sourceCode) {
    res.status(400).json({ error: "sourceCode is required" });
    return;
  }

  if (sourceCode.length > maxSourceCodeLength) {
    res.status(400).json({
      error: `sourceCode exceeds max length ${maxSourceCodeLength}`,
    });
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
    const result = await executeCode(sourceCode, language, requestId);

    console.log(
      JSON.stringify({
        event: "execute.provider.completed",
        requestId,
        roomId,
        statusId: result.status.id,
        status: result.status.description,
        token: result.token,
      }),
    );

    if (result.status.id === 3) {
      const payload = {
        type: "execution-result",
        roomId,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        time: result.time ?? "",
        memory: String(result.memory ?? ""),
        status: result.status.description,
        requestId,
      } as const;

      await publishExecutionEventBestEffort(payload, requestId);

      res.status(200).json(payload);
      console.log(JSON.stringify({ event: "execute.end", requestId, roomId, outcome: payload.type }));
      return;
    }

    const payload = buildExecutionErrorPayload(
      roomId,
      result.compile_output ?? result.stderr ?? result.message ?? result.status.description ?? "Execution failed",
      result.status.description,
      requestId,
    );

    await publishExecutionEventBestEffort(payload, requestId);

    res.status(200).json(payload);
    console.log(JSON.stringify({ event: "execute.end", requestId, roomId, outcome: payload.type }));
  } catch (error) {
    const payload = buildExecutionErrorPayload(
      roomId,
      error instanceof Error ? error.message : "Unknown error",
      "Execution Failed",
      requestId,
    );

    await publishExecutionEventBestEffort(payload, requestId);

    console.error(
      JSON.stringify({
        event: "execute.failed",
        requestId,
        roomId,
        error: payload.message,
      }),
    );

    res.status(502).json(payload);
  }
});

export { router as executeRouter };
