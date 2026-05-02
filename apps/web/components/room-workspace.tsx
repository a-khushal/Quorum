"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";

import { apiRequest } from "../lib/api";
import { buildWsUrl } from "../lib/ws";
import { useAuth } from "./auth-provider";
import { AppShell } from "./app-shell";
import { CodeEditor } from "./code-editor";
import { useToast } from "./toast-provider";
import { VideoCallPanel } from "./video-call-panel";

type RoomLanguage = "TYPESCRIPT" | "PYTHON" | "JAVA" | "GO" | "CPP" | "C";

type RoomResponse = {
  room: {
    id: string;
    createdBy: string;
    status: string;
    language: RoomLanguage;
  };
  presence: {
    state: string | null;
    userCount: number;
  };
};

type RelayEvent =
  | {
      type: "execution-result";
      roomId: string;
      stdout: string;
      stderr: string;
      status: string;
      requestId?: string;
    }
  | {
      type: "execution-error";
      roomId: string;
      message: string;
      status: string;
      requestId?: string;
    }
  | {
      type: "peer-joined" | "peer-left";
      roomId: string;
      userId: string;
      channel: string;
    };

const languages: RoomLanguage[] = ["TYPESCRIPT", "PYTHON", "JAVA", "GO", "CPP", "C"];
const maxSourceCodeLength = 20_000;

const defaultTemplates: Record<RoomLanguage, string> = {
  TYPESCRIPT: "console.log('hello from quorum')",
  PYTHON: "print('hello from quorum')",
  JAVA:
    "public class Main {\n  public static void main(String[] args) {\n    System.out.println(\"hello from quorum\");\n  }\n}",
  GO: 'package main\n\nimport "fmt"\n\nfunc main() {\n  fmt.Println("hello from quorum")\n}',
  CPP:
    "#include <iostream>\n\nint main() {\n  std::cout << \"hello from quorum\" << std::endl;\n  return 0;\n}",
  C: '#include <stdio.h>\n\nint main() {\n  printf("hello from quorum\\n");\n  return 0;\n}',
};

const getDraftKey = (roomId: string) => `quorum_room_draft_${roomId}`;

const sanitizeOutput = (value: string) => {
  return value.split(String.fromCharCode(0)).join("");
};

const markRequestIdSeen = (store: Set<string>, requestId: string) => {
  store.add(requestId);
  if (store.size > 100) {
    const first = store.values().next().value;
    if (first) {
      store.delete(first);
    }
  }
};

export const RoomWorkspace = ({ roomId }: { roomId: string }) => {
  const router = useRouter();
  const { accessToken, user, logout } = useAuth();
  const [room, setRoom] = useState<RoomResponse["room"] | null>(null);
  const [presence, setPresence] = useState<RoomResponse["presence"] | null>(null);
  const [sourceCode, setSourceCode] = useState(defaultTemplates.TYPESCRIPT);
  const [language, setLanguage] = useState<RoomLanguage>("TYPESCRIPT");
  const [output, setOutput] = useState("Waiting for execution...");
  const [executionState, setExecutionState] = useState<"idle" | "running" | "success" | "error">("idle");
  const [connectionState, setConnectionState] = useState<"connected" | "reconnecting" | "disconnected">("disconnected");
  const [error, setError] = useState("");
  const [roomNotFound, setRoomNotFound] = useState(false);
  const relaySocketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const yjsSocketRef = useRef<WebSocket | null>(null);
  const yDocRef = useRef<Y.Doc | null>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  const isApplyingRemoteUpdateRef = useRef(false);
  const recentRequestIdsRef = useRef<Set<string>>(new Set());
  const previousConnectionStateRef = useRef<"connected" | "reconnecting" | "disconnected">("disconnected");
  const { pushToast } = useToast();

  const canExecute = useMemo(() => {
    if (!room || !user) {
      return false;
    }

    return room.createdBy === user.id && room.status !== "ENDED";
  }, [room, user]);

  useEffect(() => {
    const loadRoom = async () => {
      try {
        const response = await apiRequest<RoomResponse>(`/rooms/${roomId}`, { accessToken });
        setRoom(response.room);
        setPresence(response.presence);
        const roomLanguage = response.room.language ?? "TYPESCRIPT";
        setLanguage(roomLanguage);

        const draftKey = getDraftKey(roomId);
        const draft = window.localStorage.getItem(draftKey);
        setSourceCode(draft && draft.trim() ? draft : defaultTemplates[roomLanguage]);
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "Failed to load room";
        setError(message);
        if (message.toLowerCase().includes("not found")) {
          setRoomNotFound(true);
        }
        if (message.toLowerCase().includes("unauthorized") || message.toLowerCase().includes("token")) {
          pushToast("Session expired. Please login again.", "error");
          router.replace("/auth");
        }
      }
    };

    if (accessToken) {
      void loadRoom();
    }
  }, [accessToken, pushToast, roomId, router]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    let active = true;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const handleMessage = (event: MessageEvent<string>) => {
      let message: RelayEvent;

      try {
        message = JSON.parse(event.data) as RelayEvent;
      } catch {
        return;
      }

      if (message.type === "execution-result") {
        if (message.requestId && recentRequestIdsRef.current.has(message.requestId)) {
          return;
        }

        if (message.requestId) {
          markRequestIdSeen(recentRequestIdsRef.current, message.requestId);
        }

        setOutput(message.stdout || "(no output)");
        setExecutionState("success");
        pushToast("Execution completed", "success");
        return;
      }

      if (message.type === "execution-error") {
        if (message.requestId && recentRequestIdsRef.current.has(message.requestId)) {
          return;
        }

        if (message.requestId) {
          markRequestIdSeen(recentRequestIdsRef.current, message.requestId);
        }

        setOutput(`${message.status}: ${message.message}`);
        setExecutionState("error");
        pushToast("Execution failed", "error");
        return;
      }

      setPresence((prev) => {
        if (!prev) {
          return prev;
        }

        return {
          ...prev,
          userCount: Math.max(1, prev.userCount + (message.type === "peer-joined" ? 1 : -1)),
        };
      });
    };

    const scheduleReconnect = () => {
      if (!active) {
        return;
      }

      clearReconnectTimer();
      const cappedAttempt = Math.min(reconnectAttemptRef.current, 6);
      const backoffMs = 600 * 2 ** cappedAttempt;
      const jitterMs = Math.floor(Math.random() * 250);
      const delayMs = Math.min(10_000, backoffMs + jitterMs);

      setConnectionState("reconnecting");
      reconnectTimerRef.current = setTimeout(() => {
        reconnectAttemptRef.current += 1;
        connectRelay();
      }, delayMs);
    };

    const connectRelay = () => {
      if (!active) {
        return;
      }

      const ws = new WebSocket(buildWsUrl("/ws/relay", roomId, accessToken));
      relaySocketRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        setConnectionState("connected");
      };

      ws.onclose = () => {
        if (!active) {
          return;
        }

        scheduleReconnect();
      };

      ws.onerror = () => {
        if (!active) {
          return;
        }

        ws.close();
      };

      ws.onmessage = handleMessage;
    };

    setConnectionState("reconnecting");
    connectRelay();

    return () => {
      active = false;
      clearReconnectTimer();

      const currentSocket = relaySocketRef.current;
      relaySocketRef.current = null;
      reconnectAttemptRef.current = 0;
      setConnectionState("disconnected");

      if (currentSocket) {
        currentSocket.onopen = null;
        currentSocket.onclose = null;
        currentSocket.onerror = null;
        currentSocket.onmessage = null;
        currentSocket.close();
      }
    };
  }, [accessToken, pushToast, roomId]);

  useEffect(() => {
    const prev = previousConnectionStateRef.current;
    if (prev === "reconnecting" && connectionState === "connected") {
      pushToast("Relay reconnected", "success");
    }
    if (prev !== "disconnected" && connectionState === "disconnected") {
      pushToast("Relay disconnected", "error");
    }
    previousConnectionStateRef.current = connectionState;
  }, [connectionState, pushToast]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    const yDoc = new Y.Doc();
    const yText = yDoc.getText("source");
    yDocRef.current = yDoc;
    yTextRef.current = yText;

    const ws = new WebSocket(buildWsUrl("/ws/yjs", roomId, accessToken));
    ws.binaryType = "arraybuffer";
    yjsSocketRef.current = ws;

    const onYTextUpdate = (event: Y.YTextEvent) => {
      const origin = event.transaction.origin;
      if (origin === "local-editor") {
        return;
      }

      isApplyingRemoteUpdateRef.current = true;
      setSourceCode(yText.toString());
      isApplyingRemoteUpdateRef.current = false;
    };

    yText.observe(onYTextUpdate);

    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "ws-sync") {
        return;
      }

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(update);
      }
    };

    yDoc.on("update", onDocUpdate);

    ws.onmessage = (event) => {
      const data = event.data;
      const update = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data as ArrayBufferLike);
      Y.applyUpdate(yDoc, update, "ws-sync");
    };

    return () => {
      yText.unobserve(onYTextUpdate);
      yDoc.off("update", onDocUpdate);
      ws.close();
      yjsSocketRef.current = null;
      yTextRef.current = null;
      yDocRef.current = null;
    };
  }, [accessToken, roomId]);

  useEffect(() => {
    window.localStorage.setItem(getDraftKey(roomId), sourceCode);
  }, [roomId, sourceCode]);

  useEffect(() => {
    const yText = yTextRef.current;
    if (!yText || isApplyingRemoteUpdateRef.current) {
      return;
    }

    const current = yText.toString();
    if (current === sourceCode) {
      return;
    }

    yText.doc?.transact(() => {
      yText.delete(0, yText.length);
      yText.insert(0, sourceCode);
    }, "local-editor");
  }, [sourceCode]);

  const runCode = async () => {
    if (!languages.includes(language)) {
      setExecutionState("error");
      setOutput("Unsupported language selected");
      return;
    }

    if (sourceCode.length > maxSourceCodeLength) {
      setExecutionState("error");
      setOutput(`Source code exceeds max length ${maxSourceCodeLength}`);
      return;
    }

    setExecutionState("running");
    setError("");
    try {
      const result = await apiRequest<{ type: string; stdout?: string; message?: string; status?: string; requestId?: string }>("/execute", {
        method: "POST",
        accessToken,
        body: {
          roomId,
          language,
          sourceCode,
        },
      });

      if (result.type === "execution-result") {
        if (result.requestId && recentRequestIdsRef.current.has(result.requestId)) {
          return;
        }

        if (result.requestId) {
          markRequestIdSeen(recentRequestIdsRef.current, result.requestId);
        }

        setOutput(sanitizeOutput(result.stdout ?? "(no output)"));
        setExecutionState("success");
        pushToast("Execution completed", "success");
      }

      if (result.type === "execution-error") {
        if (result.requestId && recentRequestIdsRef.current.has(result.requestId)) {
          return;
        }

        if (result.requestId) {
          markRequestIdSeen(recentRequestIdsRef.current, result.requestId);
        }

        setOutput(`${result.status ?? "Error"}: ${result.message ?? "Execution failed"}`);
        setExecutionState("error");
        pushToast("Execution failed", "error");
      }
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : "Execution failed";
      setOutput(message);
      setExecutionState("error");
      pushToast("Execution request failed", "error");
    }
  };

  const endRoom = async () => {
    try {
      const response = await apiRequest<{ room: RoomResponse["room"] }>(`/rooms/${roomId}/end`, {
        method: "PATCH",
        accessToken,
      });
      setRoom(response.room);
    } catch (endError) {
      setError(endError instanceof Error ? endError.message : "Failed to end room");
    }
  };

  return (
    <AppShell roomId={roomId} connectionState={connectionState} userEmail={user?.email ?? ""} onLogout={logout}>
      <main className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <section className="flex w-full flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold">Editor</h2>
            <select
              className="rounded-lg border border-stone-300 bg-white px-3 py-2"
              value={language}
              onChange={(event) => setLanguage(event.target.value as RoomLanguage)}
            >
              {languages.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </div>
            <CodeEditor language={language} value={sourceCode} onChange={setSourceCode} />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rounded-lg bg-teal-700 px-4 py-2 font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!canExecute || executionState === "running"}
              onClick={() => void runCode()}
            >
              {executionState === "running" ? "Running..." : "Run"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-stone-300 bg-stone-100 px-4 py-2 font-medium text-stone-800 transition hover:bg-stone-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!canExecute || room?.status === "ENDED"}
              onClick={() => void endRoom()}
            >
              End Room
            </button>
            {!canExecute ? <span className="text-sm text-stone-500">Only room creator can execute code</span> : null}
            <span className="rounded-full border border-stone-300 px-3 py-1 text-xs uppercase tracking-wide text-stone-600">
              execution: {executionState}
            </span>
          </div>
        </section>

        <aside className="flex h-fit flex-col gap-2 rounded-2xl border border-stone-200 bg-stone-50 p-4 shadow-sm">
          <h3 className="text-lg font-semibold">Room Status</h3>
          {roomNotFound ? <p className="text-sm text-rose-700">Room not found. Check room id and try again.</p> : null}
          <p className="text-sm">Status: <span className="font-medium">{room?.status ?? "loading"}</span></p>
          <p className="text-sm">Presence: <span className="font-medium">{presence?.state ?? "unknown"}</span></p>
          <p className="text-sm">Participants: <span className="font-medium">{presence?.userCount ?? 0}</span></p>
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          <button
            type="button"
            className="mt-2 rounded-lg border border-stone-300 bg-stone-100 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-200"
            onClick={() => router.push("/")}
          >
            Back to Home
          </button>
        </aside>
      </main>

      <section className="rounded-2xl border border-stone-200 bg-stone-50 p-4 shadow-sm">
        <h3 className="text-lg font-semibold">Execution Output</h3>
        <pre className="mt-3 min-h-32 overflow-auto rounded-xl bg-stone-900 p-3 font-mono text-sm text-stone-100">{output}</pre>
      </section>

      {user?.id ? <VideoCallPanel roomId={roomId} accessToken={accessToken} currentUserId={user.id} /> : null}
    </AppShell>
  );
};
