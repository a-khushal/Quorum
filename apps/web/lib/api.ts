import { webEnv } from "./env";

type HttpMethod = "GET" | "POST" | "PATCH";

type ApiRequestOptions = {
  method?: HttpMethod;
  body?: unknown;
  accessToken?: string;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const apiRequest = async <T>(path: string, options: ApiRequestOptions = {}): Promise<T> => {
  const response = await fetch(`${webEnv.apiUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    credentials: "include",
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const raw = (await response.text()) || "{}";
  const data = JSON.parse(raw) as { error?: string; message?: string } & T;

  if (!response.ok) {
    throw new ApiError(data.error ?? data.message ?? "Request failed", response.status);
  }

  return data;
};
