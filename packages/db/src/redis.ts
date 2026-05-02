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

export { ROOM_TTL_SECONDS };
