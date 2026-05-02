import { getRoomState } from "@repo/db/redis";
import type { WebSocket } from "ws";

import type { Channel, RoomSocketsMap } from "./types.js";

export const getChannelFromPath = (pathname: string): Channel | null => {
  if (pathname === "/ws/yjs") return "yjs";
  if (pathname === "/ws/signal") return "signal";
  if (pathname === "/ws/relay") return "relay";
  return null;
};

export const validateRoom = async (roomId: string) => {
  const roomState = await getRoomState(roomId);
  return Boolean(roomState);
};

const roomChannelKey = (roomId: string, channel: Channel) => {
  return `${roomId}:${channel}`;
};

export const addSocketToRoom = (rooms: RoomSocketsMap, roomId: string, channel: Channel, ws: WebSocket) => {
  const key = roomChannelKey(roomId, channel);
  const sockets = rooms.get(key) ?? new Set<WebSocket>();
  sockets.add(ws);
  rooms.set(key, sockets);
};

export const removeSocketFromRoom = (rooms: RoomSocketsMap, roomId: string, channel: Channel, ws: WebSocket) => {
  const key = roomChannelKey(roomId, channel);
  const sockets = rooms.get(key);
  if (!sockets) {
    return;
  }

  sockets.delete(ws);
  if (sockets.size === 0) {
    rooms.delete(key);
  }
};

export const getSocketsForRoom = (rooms: RoomSocketsMap, roomId: string, channel: Channel) => {
  const key = roomChannelKey(roomId, channel);
  return rooms.get(key) ?? new Set<WebSocket>();
};
