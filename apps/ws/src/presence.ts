import { addUserToRoom, removeUserFromRoom } from "@repo/db/redis";
import { WebSocket } from "ws";

import { getSocketsForRoom } from "./rooms.js";
import type { PresenceEvent, RoomSocketsMap } from "./types.js";

export const setPresenceOnConnect = async (roomId: string, userId: string) => {
  await addUserToRoom(roomId, userId);
};

export const setPresenceOnDisconnect = async (roomId: string, userId: string) => {
  await removeUserFromRoom(roomId, userId);
};

const sendJson = (ws: WebSocket, payload: unknown) => {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(JSON.stringify(payload));
};

export const broadcastPresence = (
  rooms: RoomSocketsMap,
  event: PresenceEvent,
  except?: WebSocket,
) => {
  const sockets = getSocketsForRoom(rooms, event.roomId, event.channel);

  for (const socket of sockets) {
    if (socket === except || socket.readyState !== WebSocket.OPEN) {
      continue;
    }

    sendJson(socket, event);
  }
};
