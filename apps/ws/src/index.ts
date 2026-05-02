import "dotenv/config";

import http from "node:http";
import { URL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";

import { rejectUpgrade, verifyAccessToken } from "./auth.js";
import { handleRelayMessage } from "./channels/relay.js";
import { handleSignalMessage } from "./channels/signal.js";
import { handleYjsMessage, sendFullStateOnJoin } from "./channels/yjs.js";
import { broadcastPresence, setPresenceOnConnect, setPresenceOnDisconnect } from "./presence.js";
import { addSocketToRoom, getChannelFromPath, removeSocketFromRoom, validateRoom } from "./rooms.js";
import type { RoomSocketsMap, SocketContext } from "./types.js";

const port = Number(process.env.WS_PORT ?? 3002);

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });

const roomDocs: Map<string, import("yjs").Doc> = new Map();
const roomSockets: RoomSocketsMap = new Map();
const socketContexts = new WeakMap<WebSocket, SocketContext>();
const heartbeatState = new WeakMap<WebSocket, { isAlive: boolean }>();

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

    let authPayload;

    try {
      authPayload = verifyAccessToken(token);
    } catch {
      rejectUpgrade(socket, 401, "Invalid access token");
      return;
    }

    const isValidRoom = await validateRoom(roomId);
    if (!isValidRoom) {
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
      addSocketToRoom(roomSockets, roomId, channel, ws);
      heartbeatState.set(ws, { isAlive: true });

      if (channel === "yjs") {
        sendFullStateOnJoin({ roomDocs, roomSockets }, roomId, ws);
      }

      void setPresenceOnConnect(roomId, authPayload.sub);

      broadcastPresence(
        roomSockets,
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
      handleYjsMessage({ roomDocs, roomSockets }, context.roomId, ws, data, isBinary);
      return;
    }

    if (context.channel === "signal") {
      handleSignalMessage({ roomSockets }, context.roomId, context.userId, ws, data, isBinary);
      return;
    }

    handleRelayMessage({ roomSockets }, context.roomId, ws, data, isBinary);
  });

  ws.on("close", () => {
    heartbeatState.delete(ws);
    removeSocketFromRoom(roomSockets, context.roomId, context.channel, ws);
    void setPresenceOnDisconnect(context.roomId, context.userId);

    broadcastPresence(roomSockets, {
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
