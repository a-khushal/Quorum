import * as Y from "yjs";
import { type RawData, WebSocket } from "ws";
import { getRoomYjsState, setRoomYjsState } from "@repo/db/redis";

import { getSocketsForRoom } from "../rooms.js";
import type { RoomSocketsMap } from "../types.js";

type YjsChannelDeps = {
  roomDocs: Map<string, Y.Doc>;
  roomSockets: RoomSocketsMap;
};

const persistenceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const PERSISTENCE_DEBOUNCE_MS = 500;

const toUint8Array = (data: RawData): Uint8Array => {
  if (data instanceof Buffer) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }

  return Buffer.from(data);
};

const schedulePersistence = (roomId: string, doc: Y.Doc) => {
  const existing = persistenceTimers.get(roomId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    persistenceTimers.delete(roomId);
    const state = Y.encodeStateAsUpdate(doc);
    void setRoomYjsState(roomId, state);
  }, PERSISTENCE_DEBOUNCE_MS);

  persistenceTimers.set(roomId, timer);
};

export const getOrCreateDoc = (roomDocs: Map<string, Y.Doc>, roomId: string) => {
  const existing = roomDocs.get(roomId);
  if (existing) {
    return existing;
  }

  const doc = new Y.Doc();
  roomDocs.set(roomId, doc);
  return doc;
};

export const loadDocFromRedis = async (roomDocs: Map<string, Y.Doc>, roomId: string) => {
  const doc = getOrCreateDoc(roomDocs, roomId);
  
  const savedState = await getRoomYjsState(roomId);
  if (savedState && savedState.byteLength > 0) {
    try {
      Y.applyUpdate(doc, savedState);
    } catch { /* invalid state */ }
  }

  return doc;
};

export const sendFullStateOnJoin = async (deps: YjsChannelDeps, roomId: string, ws: WebSocket) => {
  const doc = await loadDocFromRedis(deps.roomDocs, roomId);
  const fullState = Y.encodeStateAsUpdate(doc);
  ws.send(fullState, { binary: true });
};

export const handleYjsMessage = (
  deps: YjsChannelDeps,
  roomId: string,
  ws: WebSocket,
  data: RawData,
  isBinary: boolean,
) => {
  if (!isBinary) {
    return;
  }

  const doc = getOrCreateDoc(deps.roomDocs, roomId);
  const update = toUint8Array(data);

  Y.applyUpdate(doc, update);
  schedulePersistence(roomId, doc);

  const sockets = getSocketsForRoom(deps.roomSockets, roomId, "yjs");
  for (const socket of sockets) {
    if (socket === ws || socket.readyState !== WebSocket.OPEN) {
      continue;
    }

    socket.send(update, { binary: true });
  }
};
