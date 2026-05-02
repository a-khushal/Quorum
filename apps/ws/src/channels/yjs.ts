import * as Y from "yjs";
import { type RawData, WebSocket } from "ws";

import { getSocketsForRoom } from "../rooms.js";
import type { RoomSocketsMap } from "../types.js";

type YjsChannelDeps = {
  roomDocs: Map<string, Y.Doc>;
  roomSockets: RoomSocketsMap;
};

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

export const getOrCreateDoc = (roomDocs: Map<string, Y.Doc>, roomId: string) => {
  const existing = roomDocs.get(roomId);
  if (existing) {
    return existing;
  }

  const doc = new Y.Doc();
  roomDocs.set(roomId, doc);
  return doc;
};

export const sendFullStateOnJoin = (deps: YjsChannelDeps, roomId: string, ws: WebSocket) => {
  const doc = getOrCreateDoc(deps.roomDocs, roomId);
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

  const sockets = getSocketsForRoom(deps.roomSockets, roomId, "yjs");
  for (const socket of sockets) {
    if (socket === ws || socket.readyState !== WebSocket.OPEN) {
      continue;
    }

    socket.send(update, { binary: true });
  }
};
