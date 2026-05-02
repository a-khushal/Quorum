import { type RawData, WebSocket } from "ws";

import { getSocketsForRoom } from "../rooms.js";
import type { RoomSocketsMap } from "../types.js";

type SignalChannelDeps = {
  roomSockets: RoomSocketsMap;
};

const sendJson = (ws: WebSocket, payload: unknown) => {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(JSON.stringify(payload));
};

const getSignalPeer = (deps: SignalChannelDeps, roomId: string, sender: WebSocket) => {
  const sockets = getSocketsForRoom(deps.roomSockets, roomId, "signal");

  for (const socket of sockets) {
    if (socket !== sender && socket.readyState === WebSocket.OPEN) {
      return socket;
    }
  }

  return null;
};

export const handleSignalMessage = (
  deps: SignalChannelDeps,
  roomId: string,
  userId: string,
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
  if (!["offer", "answer", "ice", "leave", "renegotiate"].includes(parsedType)) {
    sendJson(ws, { type: "error", message: "Unsupported signaling message" });
    return;
  }

  const peer = getSignalPeer(deps, roomId, ws);
  if (!peer) {
    return;
  }

  sendJson(peer, {
    ...parsed,
    fromUserId: userId,
  });
};
