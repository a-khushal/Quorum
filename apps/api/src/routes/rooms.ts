import prisma from "@repo/db";
import {
  addUserToRoom,
  deleteRoomState,
  getChatMessages,
  getRoomExecutionSnapshot,
  getRoomState,
  getRoomUserCount,
  setRoomState,
} from "@repo/db/redis";
import type { Response } from "express";
import { Router } from "express";

import { type AuthenticatedRequest, validateToken } from "../middleware/validateToken.js";
import { publishRelayEvent } from "../services/executionRelay.js";

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

  const normalizedValue = value.trim().toUpperCase();
  if (!normalizedValue) {
    return undefined;
  }

  return isRoomLanguage(normalizedValue) ? normalizedValue : undefined;
};

const getParam = (value: string | string[] | undefined) => {
  return typeof value === "string" ? value : "";
};

router.use(validateToken);

router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user?.id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const requestedLanguage = req.body?.language;
  const language = parseRoomLanguage(requestedLanguage);

  if (typeof requestedLanguage === "string" && requestedLanguage.trim() && !language) {
    res.status(400).json({
      error: "Unsupported language",
      allowedLanguages,
    });
    return;
  }

  const room = language
    ? await prisma.room.create({
        data: {
          createdBy: req.user.id,
          status: "CREATED",
          language,
        },
      })
    : await prisma.room.create({
        data: {
          createdBy: req.user.id,
          status: "CREATED",
        },
      });

  await setRoomState(room.id, "created");
  await addUserToRoom(room.id, req.user.id);

  res.status(201).json({ room });
});

router.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
  const roomId = getParam(req.params.id);

  const room = await prisma.room.findUnique({
    where: { id: roomId },
  });

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const roomState = await getRoomState(room.id);
  const userCount = await getRoomUserCount(room.id);
  const lastExecution = await getRoomExecutionSnapshot(room.id);
  const chatMessages = await getChatMessages(room.id);

  res.status(200).json({
    room,
    presence: {
      state: roomState,
      userCount,
    },
    lastExecution,
    chatMessages,
  });
});

router.patch("/:id/end", async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user?.id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const roomId = getParam(req.params.id);

  const room = await prisma.room.findUnique({
    where: { id: roomId },
  });

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  if (room.createdBy !== req.user.id) {
    res.status(403).json({ error: "Only room creator can end room" });
    return;
  }

  const updatedRoom = await prisma.room.update({
    where: { id: room.id },
    data: {
      status: "ENDED",
      endedAt: new Date(),
    },
  });

  // Broadcast room-ended event to all users in the room
  try {
    await publishRelayEvent({
      type: "room-ended",
      roomId: updatedRoom.id,
    });
  } catch (relayError) {
    console.error("Failed to publish room-ended event:", relayError);
  }

  await deleteRoomState(updatedRoom.id);

  res.status(200).json({ room: updatedRoom });
});

export { router as roomsRouter };
