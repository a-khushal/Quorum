import { webEnv } from "./env";

export const buildWsUrl = (path: "/ws/relay" | "/ws/yjs" | "/ws/signal", roomId: string, token: string) => {
  const url = new URL(path, webEnv.wsUrl);
  url.searchParams.set("roomId", roomId);
  url.searchParams.set("token", token);
  return url.toString();
};
