"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

import { ApiError, apiRequest, refreshAccessToken } from "../lib/api";

type AuthState = "loading" | "authenticated" | "unauthenticated";

type AuthUser = {
  id: string;
  email: string;
};

type ApiRequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
};

type AuthContextValue = {
  state: AuthState;
  user: AuthUser | null;
  accessToken: string;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  authRequest: <T>(path: string, options?: ApiRequestOptions) => Promise<T>;
};

const STORAGE_KEY = "quorum_access_token";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const readToken = () => {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(STORAGE_KEY) ?? "";
};

const writeToken = (token: string) => {
  if (typeof window === "undefined") {
    return;
  }

  if (!token) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, token);
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<AuthState>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState("");

  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;

  const tryRefreshAndValidate = async (): Promise<{ token: string; user: AuthUser } | null> => {
    const newToken = await refreshAccessToken();
    if (!newToken) return null;

    try {
      const response = await apiRequest<{ user: AuthUser }>("/protected", { accessToken: newToken });
      return { token: newToken, user: response.user };
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const initialize = async () => {
      const token = readToken();
      if (!token) {
        const refreshResult = await tryRefreshAndValidate();
        if (refreshResult) {
          writeToken(refreshResult.token);
          setAccessToken(refreshResult.token);
          setUser(refreshResult.user);
          setState("authenticated");
        } else {
          setState("unauthenticated");
        }
        return;
      }

      try {
        const response = await apiRequest<{ user: AuthUser }>("/protected", { accessToken: token });
        setAccessToken(token);
        setUser(response.user);
        setState("authenticated");
      } catch {
        const refreshResult = await tryRefreshAndValidate();
        if (refreshResult) {
          writeToken(refreshResult.token);
          setAccessToken(refreshResult.token);
          setUser(refreshResult.user);
          setState("authenticated");
        } else {
          writeToken("");
          setAccessToken("");
          setUser(null);
          setState("unauthenticated");
        }
      }
    };

    void initialize();
  }, []);

  const register = async (email: string, password: string) => {
    await apiRequest<{ user: AuthUser }>("/auth/register", {
      method: "POST",
      body: { email, password },
    });
  };

  const login = async (email: string, password: string) => {
    const response = await apiRequest<{ accessToken: string }>("/auth/login", {
      method: "POST",
      body: { email, password },
    });

    writeToken(response.accessToken);
    setAccessToken(response.accessToken);

    const userResponse = await apiRequest<{ user: AuthUser }>("/protected", {
      accessToken: response.accessToken,
    });
    setUser(userResponse.user);
    setState("authenticated");
  };

  const logout = async () => {
    try {
      await apiRequest("/auth/logout", { method: "POST", accessToken });
    } finally {
      writeToken("");
      setAccessToken("");
      setUser(null);
      setState("unauthenticated");
    }
  };

  const authRequest = async <T,>(path: string, options: ApiRequestOptions = {}): Promise<T> => {
    try {
      return await apiRequest<T>(path, { ...options, accessToken: tokenRef.current });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        const newToken = await refreshAccessToken();
        if (newToken) {
          writeToken(newToken);
          setAccessToken(newToken);
          return await apiRequest<T>(path, { ...options, accessToken: newToken });
        }
        writeToken("");
        setAccessToken("");
        setUser(null);
        setState("unauthenticated");
      }
      throw error;
    }
  };

  const value: AuthContextValue = { state, user, accessToken, login, register, logout, authRequest };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
};
