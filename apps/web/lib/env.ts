const apiUrl = process.env.NEXT_PUBLIC_API_URL;
const wsUrl = process.env.NEXT_PUBLIC_WS_URL;

if (!apiUrl) {
  throw new Error("Missing required environment variable: NEXT_PUBLIC_API_URL");
}

if (!wsUrl) {
  throw new Error("Missing required environment variable: NEXT_PUBLIC_WS_URL");
}

export const webEnv = {
  apiUrl,
  wsUrl,
};
