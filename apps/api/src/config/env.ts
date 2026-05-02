import dotenv from "dotenv";

dotenv.config();

const requiredEnv = [
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "JUDGE0_URL",
  "WS_INTERNAL_SECRET",
] as const;

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const env = {
  databaseUrl: process.env.DATABASE_URL as string,
  redisUrl: process.env.REDIS_URL as string,
  jwtSecret: process.env.JWT_SECRET as string,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET as string,
  judge0Url: process.env.JUDGE0_URL as string,
  executionProvider: (process.env.EXECUTION_PROVIDER ?? "judge0").toLowerCase(),
  wsServerUrl: process.env.WS_SERVER_URL ?? "ws://localhost:3002",
  wsInternalSecret: process.env.WS_INTERNAL_SECRET as string,
  nodeEnv: process.env.NODE_ENV ?? "development",
};
