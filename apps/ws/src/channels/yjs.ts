import * as Y from "yjs";
import { type RawData, WebSocket } from "ws";
import { getRoomYjsState, setRoomYjsState } from "@repo/db/redis";

import { getSocketsForRoom } from "../rooms.js";
import type { RoomSocketsMap } from "../types.js";

const MSG_TYPE_DOC = 0;
const MSG_TYPE_AWARENESS = 1;

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
  const msg = Buffer.alloc(fullState.length + 1);
  msg[0] = MSG_TYPE_DOC;
  msg.set(fullState, 1);
  ws.send(msg, { binary: true });
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

  const msg = toUint8Array(data);
  if (msg.length < 2) {
    return;
  }

  const msgType = msg[0];
  const payload = msg.slice(1);

  if (msgType === MSG_TYPE_DOC) {
    const doc = getOrCreateDoc(deps.roomDocs, roomId);
    try {
      Y.applyUpdate(doc, payload);
      schedulePersistence(roomId, doc);
    } catch {
      return;
    }
  } else if (msgType !== MSG_TYPE_AWARENESS) {
    return;
  }

  const sockets = getSocketsForRoom(deps.roomSockets, roomId, "yjs");
  for (const socket of sockets) {
    if (socket === ws || socket.readyState !== WebSocket.OPEN) {
      continue;
    }

    socket.send(msg, { binary: true });
  }
};
