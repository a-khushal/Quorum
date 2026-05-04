import { type RawData, WebSocket } from "ws";
import { addChatMessage } from "@repo/db/redis";

import { getSocketsForRoom } from "../rooms.js";
import type { RoomSocketsMap } from "../types.js";

type RelayChannelDeps = {
  roomSockets: RoomSocketsMap;
};

export type RelayMessage =
  | {
      type: "execution-result" | "execution-error";
      roomId: string;
      stdout?: string;
      stderr?: string;
      time?: string;
      memory?: string;
      status?: string;
      message?: string;
      requestId?: string;
    }
  | {
      type: "room-ended";
      roomId: string;
    }
  | {
      type: "chat-message";
      roomId: string;
      userId: string;
      userName: string;
      message: string;
      timestamp: number;
    };

const sendJson = (ws: WebSocket, payload: unknown) => {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(JSON.stringify(payload));
};

const broadcastJson = (deps: RelayChannelDeps, roomId: string, payload: unknown, except?: WebSocket) => {
  const sockets = getSocketsForRoom(deps.roomSockets, roomId, "relay");

  for (const socket of sockets) {
    if (socket === except || socket.readyState !== WebSocket.OPEN) {
      continue;
    }

    sendJson(socket, payload);
  }
};

export const publishRelayMessage = (deps: RelayChannelDeps, payload: RelayMessage) => {
  broadcastJson(deps, payload.roomId, payload);
};

export const handleRelayMessage = (
  deps: RelayChannelDeps,
  roomId: string,
  ws: WebSocket,
  data: RawData,
  isBinary: boolean,
) => {
  if (isBinary) {
    return;
  }

  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(data.toString()) as Record<string, unknown>;
  } catch {
    sendJson(ws, { type: "error", message: "Invalid JSON" });
    return;
  }

  const parsedRoomId = typeof parsed.roomId === "string" ? parsed.roomId : "";
  if (parsedRoomId !== roomId) {
    sendJson(ws, { type: "error", message: "roomId mismatch" });
    return;
  }

  const parsedType = typeof parsed.type === "string" ? parsed.type : "";
  if (!["execution-result", "execution-error", "room-ended", "chat-message"].includes(parsedType)) {
    sendJson(ws, { type: "error", message: "Unsupported relay message" });
    return;
  }

  if (parsedType === "chat-message") {
    const userId = typeof parsed.userId === "string" ? parsed.userId : "";
    const userName = typeof parsed.userName === "string" ? parsed.userName : "";
    const message = typeof parsed.message === "string" ? parsed.message : "";
    const timestamp = typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now();

    void addChatMessage(roomId, {
      id: `${userId}-${timestamp}`,
      userId,
      userName,
      message,
      timestamp,
    });

    broadcastJson(deps, roomId, parsed);
    return;
  }

  broadcastJson(deps, roomId, parsed);
};
