import "dotenv/config";

import { addUserToRoom, getRoomState, removeUserFromRoom } from "@repo/db/redis";
import http from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import jwt from "jsonwebtoken";
import * as Y from "yjs";
import { WebSocketServer, type RawData, WebSocket } from "ws";

type AccessTokenPayload = {
  sub: string;
  email: string;
};

type Channel = "yjs" | "signal" | "relay";

type SocketContext = {
  roomId: string;
  userId: string;
  channel: Channel;
};

type PresenceEvent = {
  type: "peer-joined" | "peer-left";
  roomId: string;
  userId: string;
  channel: Channel;
};

const port = Number(process.env.WS_PORT ?? 3002);
const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  throw new Error("JWT_SECRET is required");
}

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });

const roomDocs = new Map<string, Y.Doc>();
const roomSockets = new Map<string, Set<WebSocket>>();
const socketContexts = new WeakMap<WebSocket, SocketContext>();
const heartbeatState = new WeakMap<WebSocket, { isAlive: boolean }>();

const getChannelFromPath = (pathname: string): Channel | null => {
  if (pathname === "/ws/yjs") return "yjs";
  if (pathname === "/ws/signal") return "signal";
  if (pathname === "/ws/relay") return "relay";
  return null;
};

const roomChannelKey = (roomId: string, channel: Channel) => {
  return `${roomId}:${channel}`;
};

const getOrCreateDoc = (roomId: string) => {
  const existing = roomDocs.get(roomId);
  if (existing) {
    return existing;
  }

  const doc = new Y.Doc();
  roomDocs.set(roomId, doc);
  return doc;
};

const addSocketToRoom = (roomId: string, channel: Channel, ws: WebSocket) => {
  const key = roomChannelKey(roomId, channel);
  const sockets = roomSockets.get(key) ?? new Set<WebSocket>();
  sockets.add(ws);
  roomSockets.set(key, sockets);
};

const removeSocketFromRoom = (roomId: string, channel: Channel, ws: WebSocket) => {
  const key = roomChannelKey(roomId, channel);
  const sockets = roomSockets.get(key);
  if (!sockets) {
    return;
  }

  sockets.delete(ws);
  if (sockets.size === 0) {
    roomSockets.delete(key);
  }
};

const getSocketsForRoom = (roomId: string, channel: Channel) => {
  const key = roomChannelKey(roomId, channel);
  return roomSockets.get(key) ?? new Set<WebSocket>();
};

const sendJson = (ws: WebSocket, payload: unknown) => {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(JSON.stringify(payload));
};

const broadcastJson = (roomId: string, channel: Channel, payload: unknown, except?: WebSocket) => {
  const sockets = getSocketsForRoom(roomId, channel);

  for (const socket of sockets) {
    if (socket === except || socket.readyState !== WebSocket.OPEN) {
      continue;
    }

    sendJson(socket, payload);
  }
};

const getSignalPeer = (roomId: string, sender: WebSocket) => {
  const sockets = getSocketsForRoom(roomId, "signal");

  for (const socket of sockets) {
    if (socket !== sender && socket.readyState === WebSocket.OPEN) {
      return socket;
    }
  }

  return null;
};

const broadcastPresence = (event: PresenceEvent, except?: WebSocket) => {
  const sockets = getSocketsForRoom(event.roomId, event.channel);

  for (const socket of sockets) {
    if (socket === except || socket.readyState !== WebSocket.OPEN) {
      continue;
    }

    sendJson(socket, event);
  }
};

const rejectUpgrade = (socket: Duplex, code: number, message: string) => {
  const response =
    `HTTP/1.1 ${code} ${message}\r\n` +
    "Connection: close\r\n" +
    "Content-Type: text/plain\r\n" +
    `Content-Length: ${Buffer.byteLength(message)}\r\n` +
    "\r\n" +
    message;

  socket.write(response);
  socket.destroy();
};

const verifyAccessToken = (token: string) => {
  const payload = jwt.verify(token, jwtSecret) as AccessTokenPayload;

  if (!payload?.sub || !payload?.email) {
    throw new Error("Invalid access token payload");
  }

  return payload;
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

server.on("upgrade", async (request, socket, head) => {
  try {
    const url = new URL(request.url ?? "", "http://localhost");
    const channel = getChannelFromPath(url.pathname);

    if (!channel) {
      rejectUpgrade(socket, 404, "Unknown WebSocket path");
      return;
    }

    const token = url.searchParams.get("token");
    const roomId = url.searchParams.get("roomId");

    if (!token) {
      rejectUpgrade(socket, 401, "Missing token");
      return;
    }

    if (!roomId) {
      rejectUpgrade(socket, 400, "Missing roomId");
      return;
    }

    let authPayload: AccessTokenPayload;

    try {
      authPayload = verifyAccessToken(token);
    } catch {
      rejectUpgrade(socket, 401, "Invalid access token");
      return;
    }

    const roomState = await getRoomState(roomId);
    if (!roomState) {
      rejectUpgrade(socket, 404, "Room not found");
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const context: SocketContext = {
        roomId,
        userId: authPayload.sub,
        channel,
      };

      socketContexts.set(ws, context);
      addSocketToRoom(roomId, channel, ws);
      heartbeatState.set(ws, { isAlive: true });

      if (channel === "yjs") {
        const doc = getOrCreateDoc(roomId);
        const fullState = Y.encodeStateAsUpdate(doc);
        ws.send(fullState, { binary: true });
      }

      void addUserToRoom(roomId, authPayload.sub);

      broadcastPresence(
        {
          type: "peer-joined",
          roomId,
          userId: authPayload.sub,
          channel,
        },
        ws,
      );

      wss.emit("connection", ws);
    });
  } catch {
    rejectUpgrade(socket, 500, "Upgrade failed");
  }
});

wss.on("connection", (ws) => {
  const context = socketContexts.get(ws);
  if (!context) {
    ws.close(1011, "Missing socket context");
    return;
  }

  ws.on("pong", () => {
    const state = heartbeatState.get(ws);
    if (!state) {
      return;
    }

    state.isAlive = true;
  });

  ws.on("message", (data, isBinary) => {
    if (context.channel === "yjs") {
      if (!isBinary) {
        return;
      }

      const doc = getOrCreateDoc(context.roomId);
      const update = toUint8Array(data);

      Y.applyUpdate(doc, update);

      const sockets = getSocketsForRoom(context.roomId, "yjs");
      for (const socket of sockets) {
        if (socket === ws || socket.readyState !== WebSocket.OPEN) {
          continue;
        }

        socket.send(update, { binary: true });
      }

      return;
    }

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
    if (parsedRoomId !== context.roomId) {
      sendJson(ws, { type: "error", message: "roomId mismatch" });
      return;
    }

    if (context.channel === "signal") {
      const parsedType = typeof parsed.type === "string" ? parsed.type : "";
      if (!["offer", "answer", "ice"].includes(parsedType)) {
        sendJson(ws, { type: "error", message: "Unsupported signaling message" });
        return;
      }

      const peer = getSignalPeer(context.roomId, ws);
      if (!peer) {
        return;
      }

      sendJson(peer, {
        ...parsed,
        fromUserId: context.userId,
      });
      return;
    }

    const parsedType = typeof parsed.type === "string" ? parsed.type : "";
    if (!["execution-result", "execution-error"].includes(parsedType)) {
      sendJson(ws, { type: "error", message: "Unsupported relay message" });
      return;
    }

    broadcastJson(context.roomId, "relay", parsed);
  });

  ws.on("close", () => {
    heartbeatState.delete(ws);
    removeSocketFromRoom(context.roomId, context.channel, ws);
    void removeUserFromRoom(context.roomId, context.userId);

    broadcastPresence({
      type: "peer-left",
      roomId: context.roomId,
      userId: context.userId,
      channel: context.channel,
    });
  });

  ws.on("error", () => {
    heartbeatState.delete(ws);
  });
});

const heartbeatInterval = setInterval(() => {
  for (const roomSet of roomSockets.values()) {
    for (const ws of roomSet) {
      const state = heartbeatState.get(ws);
      if (!state) {
        ws.terminate();
        continue;
      }

      if (!state.isAlive) {
        ws.terminate();
        continue;
      }

      state.isAlive = false;
      ws.ping();
    }
  }
}, 30_000);

wss.on("close", () => {
  clearInterval(heartbeatInterval);
});

server.listen(port, () => {
  console.log(`WebSocket server running on ws://localhost:${port}`);
});
