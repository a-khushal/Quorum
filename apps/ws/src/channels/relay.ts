import { type RawData, WebSocket } from "ws";

import { getSocketsForRoom } from "../rooms.js";
import type { RoomSocketsMap } from "../types.js";

type RelayChannelDeps = {
  roomSockets: RoomSocketsMap;
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
  if (!["execution-result", "execution-error"].includes(parsedType)) {
    sendJson(ws, { type: "error", message: "Unsupported relay message" });
    return;
  }

  broadcastJson(deps, roomId, parsed);
};
