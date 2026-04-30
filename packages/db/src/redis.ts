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
  await redisClient.del([roomStateKey(roomId), roomUsersKey(roomId)]);
};

export { ROOM_TTL_SECONDS };
