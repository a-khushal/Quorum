import type { WebSocket } from "ws";

export type AccessTokenPayload = {
  sub: string;
  email: string;
};

export type Channel = "yjs" | "signal" | "relay";

export type SocketContext = {
  roomId: string;
  userId: string;
  userEmail: string;
  channel: Channel;
};

export type PresenceEvent = {
  type: "peer-joined" | "peer-left";
  roomId: string;
  userId: string;
  userName: string;
  channel: Channel;
};

export type RoomSocketsMap = Map<string, Set<WebSocket>>;
