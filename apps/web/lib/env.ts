const getRequired = (key: "NEXT_PUBLIC_API_URL" | "NEXT_PUBLIC_WS_URL") => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
};

export const webEnv = {
  apiUrl: getRequired("NEXT_PUBLIC_API_URL"),
  wsUrl: getRequired("NEXT_PUBLIC_WS_URL"),
};
