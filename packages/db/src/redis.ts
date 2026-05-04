import { createClient, type RedisClientType } from "redis";

const ROOM_TTL_SECONDS = 60 * 60 * 2;

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("REDIS_URL is required to initialize Redis client");
}

const redisClient: RedisClientType = createClient({ url: redisUrl });

if (!redisClient.isOpen) {
  void redisClient.connect();
}

const roomStateKey = (roomId: string) => `room:${roomId}:state`;
const roomUsersKey = (roomId: string) => `room:${roomId}:users`;
const roomExecutionKey = (roomId: string) => `room:${roomId}:execution`;
const roomYjsKey = (roomId: string) => `room:${roomId}:yjs`;
const roomChatKey = (roomId: string) => `room:${roomId}:chat`;
const roomLanguageKey = (roomId: string) => `room:${roomId}:language`;
const roomWhiteboardKey = (roomId: string) => `room:${roomId}:whiteboard`;

export type RoomExecutionSnapshot = {
  type: "execution-result" | "execution-error";
  roomId: string;
  stdout?: string;
  stderr?: string;
  time?: string;
  memory?: string;
  status?: string;
  message?: string;
  requestId?: string;
  createdAt: string;
};

export const setRoomState = async (roomId: string, state: string, ttlSeconds = ROOM_TTL_SECONDS) => {
  await redisClient.set(roomStateKey(roomId), state);
  await redisClient.expire(roomStateKey(roomId), ttlSeconds);
};

export const getRoomState = async (roomId: string) => {
  return redisClient.get(roomStateKey(roomId));
};

export const addUserToRoom = async (roomId: string, userId: string, ttlSeconds = ROOM_TTL_SECONDS) => {
  await redisClient.sAdd(roomUsersKey(roomId), userId);
  await redisClient.expire(roomUsersKey(roomId), ttlSeconds);
};

export const getRoomUserCount = async (roomId: string) => {
  return redisClient.sCard(roomUsersKey(roomId));
};

export const removeUserFromRoom = async (roomId: string, userId: string) => {
  await redisClient.sRem(roomUsersKey(roomId), userId);
};

export const expireRoom = async (roomId: string, ttlSeconds = ROOM_TTL_SECONDS) => {
  await redisClient.expire(roomStateKey(roomId), ttlSeconds);
  await redisClient.expire(roomUsersKey(roomId), ttlSeconds);
};

export const deleteRoomState = async (roomId: string) => {
  await redisClient.del([roomStateKey(roomId), roomUsersKey(roomId), roomExecutionKey(roomId)]);
};

export const setRoomExecutionSnapshot = async (
  roomId: string,
  snapshot: Omit<RoomExecutionSnapshot, "createdAt">,
  ttlSeconds = ROOM_TTL_SECONDS,
) => {
  const payload: RoomExecutionSnapshot = {
    ...snapshot,
    createdAt: new Date().toISOString(),
  };

  await redisClient.set(roomExecutionKey(roomId), JSON.stringify(payload));
  await redisClient.expire(roomExecutionKey(roomId), ttlSeconds);
};

export const getRoomExecutionSnapshot = async (roomId: string): Promise<RoomExecutionSnapshot | null> => {
  const raw = await redisClient.get(roomExecutionKey(roomId));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as RoomExecutionSnapshot;
  } catch {
    return null;
  }
};

export const setRoomYjsState = async (roomId: string, state: Uint8Array, ttlSeconds = ROOM_TTL_SECONDS) => {
  const base64 = Buffer.from(state).toString("base64");
  await redisClient.set(roomYjsKey(roomId), base64);
  await redisClient.expire(roomYjsKey(roomId), ttlSeconds);
};

export const getRoomYjsState = async (roomId: string): Promise<Uint8Array | null> => {
  const base64 = await redisClient.get(roomYjsKey(roomId));
  if (!base64) {
    return null;
  }

  return new Uint8Array(Buffer.from(base64, "base64"));
};

export type ChatMessageRecord = {
  id: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: number;
};

const MAX_CHAT_MESSAGES = 200;

export const addChatMessage = async (roomId: string, message: ChatMessageRecord, ttlSeconds = ROOM_TTL_SECONDS) => {
  const key = roomChatKey(roomId);
  await redisClient.rPush(key, JSON.stringify(message));
  await redisClient.lTrim(key, -MAX_CHAT_MESSAGES, -1);
  await redisClient.expire(key, ttlSeconds);
};

export const getChatMessages = async (roomId: string): Promise<ChatMessageRecord[]> => {
  const key = roomChatKey(roomId);
  const raw = await redisClient.lRange(key, 0, -1);
  
  return raw.map((item) => {
    try {
      return JSON.parse(item) as ChatMessageRecord;
    } catch {
      return null;
    }
  }).filter((msg): msg is ChatMessageRecord => msg !== null);
};

export const setRoomLanguage = async (roomId: string, language: string, ttlSeconds = ROOM_TTL_SECONDS) => {
  await redisClient.set(roomLanguageKey(roomId), language);
  await redisClient.expire(roomLanguageKey(roomId), ttlSeconds);
};

export const getRoomLanguage = async (roomId: string): Promise<string | null> => {
  return redisClient.get(roomLanguageKey(roomId));
};

export const setRoomWhiteboardState = async (roomId: string, state: Uint8Array, ttlSeconds = ROOM_TTL_SECONDS) => {
  const base64 = Buffer.from(state).toString("base64");
  await redisClient.set(roomWhiteboardKey(roomId), base64);
  await redisClient.expire(roomWhiteboardKey(roomId), ttlSeconds);
};

export const getRoomWhiteboardState = async (roomId: string): Promise<Uint8Array | null> => {
  const base64 = await redisClient.get(roomWhiteboardKey(roomId));
  if (!base64) {
    return null;
  }

  return new Uint8Array(Buffer.from(base64, "base64"));
};

export { ROOM_TTL_SECONDS };
