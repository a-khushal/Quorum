import { env } from "../config/env.js";

export type RelayPayload = {
  type: "execution-result" | "execution-error";
  roomId: string;
  stdout?: string;
  stderr?: string;
  time?: string;
  memory?: string;
  status?: string;
  message?: string;
  requestId?: string;
};

export const publishExecutionEvent = async (payload: RelayPayload) => {
  // Convert ws:// to http:// for the HTTP relay endpoint
  const httpBaseUrl = env.wsServerUrl.replace(/^ws:\/\//, "http://").replace(/^wss:\/\//, "https://");
  const endpoint = new URL("/internal/relay", httpBaseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ws-internal-secret": env.wsInternalSecret,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Relay publish failed with status ${response.status}`);
  }
};
