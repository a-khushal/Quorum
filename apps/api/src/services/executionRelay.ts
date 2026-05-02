import { WebSocket } from "ws";

import { env } from "../config/env.js";

type RelayPayload = {
  type: "execution-result" | "execution-error";
  roomId: string;
  stdout?: string;
  stderr?: string;
  time?: string;
  memory?: string;
  status?: string;
  message?: string;
};

const connectRelaySocket = async (roomId: string, accessToken: string) => {
  const url = new URL("/ws/relay", env.wsServerUrl);
  url.searchParams.set("roomId", roomId);
  url.searchParams.set("token", accessToken);

  return await new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url);

    const onOpen = () => {
      cleanup();
      resolve(socket);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      socket.off("open", onOpen);
      socket.off("error", onError);
    };

    socket.on("open", onOpen);
    socket.on("error", onError);
  });
};

const sendPayload = async (socket: WebSocket, payload: RelayPayload) => {
  return await new Promise<void>((resolve, reject) => {
    socket.send(JSON.stringify(payload), (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

export const publishExecutionEvent = async (roomId: string, accessToken: string, payload: RelayPayload) => {
  const socket = await connectRelaySocket(roomId, accessToken);

  try {
    await sendPayload(socket, payload);
  } finally {
    socket.close();
  }
};
