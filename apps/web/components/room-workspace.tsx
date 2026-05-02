"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { editor } from "monaco-editor";
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
  lastExecution: {
    type: "execution-result" | "execution-error";
    roomId: string;
    stdout?: string;
    status?: string;
    message?: string;
  } | null;
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
const maxOutputLength = 80_000;

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
  const safe = value.split(String.fromCharCode(0)).join("");
  if (safe.length <= maxOutputLength) {
    return safe;
  }

  return `${safe.slice(0, maxOutputLength)}\n\n[truncated ${safe.length - maxOutputLength} chars]`;
};

const applyTextDiff = (yText: Y.Text, nextValue: string) => {
  const prevValue = yText.toString();
  if (prevValue === nextValue) {
    return;
  }

  let start = 0;
  while (start < prevValue.length && start < nextValue.length && prevValue[start] === nextValue[start]) {
    start += 1;
  }

  let prevEnd = prevValue.length - 1;
  let nextEnd = nextValue.length - 1;
  while (prevEnd >= start && nextEnd >= start && prevValue[prevEnd] === nextValue[nextEnd]) {
    prevEnd -= 1;
    nextEnd -= 1;
  }

  const deleteCount = prevEnd - start + 1;
  const insertText = nextValue.slice(start, nextEnd + 1);

  yText.doc?.transact(() => {
    if (deleteCount > 0) {
      yText.delete(start, deleteCount);
    }

    if (insertText.length > 0) {
      yText.insert(start, insertText);
    }
  }, "local-editor");
};

const addHistoryEntry = (
  setHistory: React.Dispatch<React.SetStateAction<Array<{ id: string; status: string; at: string }>>>,
  status: string,
) => {
  setHistory((prev) => [{ id: crypto.randomUUID(), status, at: new Date().toLocaleTimeString() }, ...prev].slice(0, 8));
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
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const hasSyncedYjsRef = useRef(false);
  const pendingInitialDraftRef = useRef<string | null>(null);
  const [executionHistory, setExecutionHistory] = useState<Array<{ id: string; status: string; at: string }>>([]);
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
        const initialDraft = draft && draft.trim() ? draft : defaultTemplates[roomLanguage];
        pendingInitialDraftRef.current = initialDraft;
        setSourceCode(initialDraft);

        if (response.lastExecution) {
          if (response.lastExecution.type === "execution-result") {
            setOutput(sanitizeOutput(response.lastExecution.stdout ?? "(no output)"));
            setExecutionState("success");
          } else {
            setOutput(
              sanitizeOutput(
                `${response.lastExecution.status ?? "Execution Failed"}: ${response.lastExecution.message ?? "Execution failed"}`,
              ),
            );
            setExecutionState("error");
          }
        }
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
        addHistoryEntry(setExecutionHistory, "success");
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

        setOutput(sanitizeOutput(`${message.status}: ${message.message}`));
        setExecutionState("error");
        addHistoryEntry(setExecutionHistory, "error");
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

      const syncLatestExecution = async () => {
        try {
          const response = await apiRequest<RoomResponse>(`/rooms/${roomId}`, { accessToken });
          if (!response.lastExecution) {
            return;
          }

          if (response.lastExecution.type === "execution-result") {
            setOutput(sanitizeOutput(response.lastExecution.stdout ?? "(no output)"));
            setExecutionState("success");
            return;
          }

          setOutput(
            sanitizeOutput(
              `${response.lastExecution.status ?? "Execution Failed"}: ${response.lastExecution.message ?? "Execution failed"}`,
            ),
          );
          setExecutionState("error");
        } catch {
          // best-effort hydrate after reconnect
        }
      };

      if (accessToken) {
        void syncLatestExecution();
      }
    }
    if (prev !== "disconnected" && connectionState === "disconnected") {
      pushToast("Relay disconnected", "error");
    }
    previousConnectionStateRef.current = connectionState;
  }, [accessToken, connectionState, pushToast, roomId]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    const yDoc = new Y.Doc();
    const yText = yDoc.getText("source");
    hasSyncedYjsRef.current = false;
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

      const currentEditor = editorRef.current;
      const previousSelection = currentEditor?.getSelection();
      const previousPosition = currentEditor?.getPosition();

      isApplyingRemoteUpdateRef.current = true;
      setSourceCode(yText.toString());
      isApplyingRemoteUpdateRef.current = false;

      if (currentEditor) {
        if (previousSelection) {
          currentEditor.setSelection(previousSelection);
        }
        if (previousPosition) {
          currentEditor.setPosition(previousPosition);
        }
      }
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
      if (typeof event.data === "string") {
        return;
      }

      const data = event.data;
      let update: Uint8Array;

      if (data instanceof ArrayBuffer) {
        update = new Uint8Array(data);
      } else if (data instanceof Blob) {
        return;
      } else {
        update = new Uint8Array(data as ArrayBufferLike);
      }

      if (update.byteLength === 0) {
        return;
      }

      try {
        Y.applyUpdate(yDoc, update, "ws-sync");
        hasSyncedYjsRef.current = true;

        const draft = pendingInitialDraftRef.current;
        if (draft && yText.length === 0) {
          applyTextDiff(yText, draft);
        }
        pendingInitialDraftRef.current = null;
      } catch {
        return;
      }
    };

    ws.onopen = () => {
      setTimeout(() => {
        if (!hasSyncedYjsRef.current) {
          const draft = pendingInitialDraftRef.current;
          if (draft && yText.length === 0) {
            applyTextDiff(yText, draft);
          }
          pendingInitialDraftRef.current = null;
          hasSyncedYjsRef.current = true;
        }
      }, 500);
    };

    return () => {
      yText.unobserve(onYTextUpdate);
      yDoc.off("update", onDocUpdate);
      ws.close();
      yjsSocketRef.current = null;
      yTextRef.current = null;
      yDocRef.current = null;
      hasSyncedYjsRef.current = false;
      pendingInitialDraftRef.current = null;
    };
  }, [accessToken, roomId]);

  useEffect(() => {
    window.localStorage.setItem(getDraftKey(roomId), sourceCode);
  }, [roomId, sourceCode]);

  const onEditorChange = (next: string) => {
    setSourceCode(next);
    const yText = yTextRef.current;
    if (!yText || isApplyingRemoteUpdateRef.current) {
      return;
    }

    applyTextDiff(yText, next);
  };

  const runCode = async () => {
    if (!languages.includes(language)) {
      setExecutionState("error");
      setOutput(sanitizeOutput("Unsupported language selected"));
      return;
    }

    if (sourceCode.length > maxSourceCodeLength) {
      setExecutionState("error");
      setOutput(sanitizeOutput(`Source code exceeds max length ${maxSourceCodeLength}`));
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
        addHistoryEntry(setExecutionHistory, "success");
        pushToast("Execution completed", "success");
      }

      if (result.type === "execution-error") {
        if (result.requestId && recentRequestIdsRef.current.has(result.requestId)) {
          return;
        }

        if (result.requestId) {
          markRequestIdSeen(recentRequestIdsRef.current, result.requestId);
        }

        setOutput(sanitizeOutput(`${result.status ?? "Error"}: ${result.message ?? "Execution failed"}`));
        setExecutionState("error");
        addHistoryEntry(setExecutionHistory, "error");
        pushToast("Execution failed", "error");
      }
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : "Execution failed";
      setOutput(sanitizeOutput(message));
      setExecutionState("error");
      addHistoryEntry(setExecutionHistory, "error");
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
            <CodeEditor
              language={language}
              value={sourceCode}
              onChange={onEditorChange}
              onEditorMount={(instance) => {
                editorRef.current = instance;
              }}
            />
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
            <span className="text-xs text-stone-500">
              {sourceCode.length}/{maxSourceCodeLength}
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
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Recent Runs</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {executionHistory.length === 0 ? <span className="text-sm text-stone-500">No runs yet</span> : null}
            {executionHistory.map((entry) => (
              <span
                key={entry.id}
                className={`rounded-full border px-3 py-1 text-xs ${entry.status === "success" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-rose-300 bg-rose-50 text-rose-700"}`}
              >
                {entry.status} at {entry.at}
              </span>
            ))}
          </div>
        </div>
      </section>

      {user?.id ? <VideoCallPanel roomId={roomId} accessToken={accessToken} currentUserId={user.id} /> : null}
    </AppShell>
  );
};
