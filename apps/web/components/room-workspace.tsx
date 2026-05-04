"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import * as Y from "yjs";

import { apiRequest } from "../lib/api";
import { buildWsUrl } from "../lib/ws";
import { useAuth } from "./auth-provider";
import { AppShell } from "./app-shell";
import { ChatPanel, type ChatMessage } from "./chat-panel";
import { CodeEditor } from "./code-editor";
import { EditorToolbar } from "./editor-toolbar";
import { OutputPanel } from "./output-panel";
import { useToast } from "./toast-provider";
import { VideoPanel } from "./video-panel";

const VIDEO_COLLAPSED_KEY = "quorum_video_collapsed";
const BOTTOM_TAB_KEY = "quorum_bottom_tab";

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
  chatMessages?: Array<{
    id: string;
    userId: string;
    userName: string;
    message: string;
    timestamp: number;
  }>;
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
    }
  | {
      type: "room-ended";
      roomId: string;
    }
  | {
      type: "chat-message";
      roomId: string;
      userId: string;
      userName: string;
      message: string;
      timestamp: number;
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
  const videoPanelRef = usePanelRef();
  const [executionHistory, setExecutionHistory] = useState<Array<{ id: string; status: string; at: string }>>([]);
  const [videoCollapsed, setVideoCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(VIDEO_COLLAPSED_KEY) === "true";
    }
    return false; // Default: expanded
  });
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [bottomTab, setBottomTab] = useState<"output" | "chat">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(BOTTOM_TAB_KEY);
      return saved === "chat" ? "chat" : "output";
    }
    return "output";
  });
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const { pushToast } = useToast();

  const toggleVideoPanel = useCallback(() => {
    const panel = videoPanelRef.current;
    if (!panel) return;

    if (panel.isCollapsed()) {
      panel.expand();
      setVideoCollapsed(false);
      localStorage.setItem(VIDEO_COLLAPSED_KEY, "false");
    } else {
      panel.collapse();
      setVideoCollapsed(true);
      localStorage.setItem(VIDEO_COLLAPSED_KEY, "true");
    }
  }, [videoPanelRef]);

  const sendChatMessage = useCallback(
    (message: string) => {
      const ws = relaySocketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !user) return;

      const chatEvent = {
        type: "chat-message",
        roomId,
        userId: user.id,
        userName: user.email.split("@")[0],
        message,
        timestamp: Date.now(),
      };
      ws.send(JSON.stringify(chatEvent));
    },
    [roomId, user],
  );

  const switchToChat = useCallback(() => {
    setBottomTab("chat");
    setUnreadChatCount(0);
    localStorage.setItem(BOTTOM_TAB_KEY, "chat");
  }, []);

  const switchToOutput = useCallback(() => {
    setBottomTab("output");
    localStorage.setItem(BOTTOM_TAB_KEY, "output");
  }, []);

  // Restore collapsed state from localStorage on mount
  useEffect(() => {
    if (videoCollapsed && videoPanelRef.current) {
      videoPanelRef.current.collapse();
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcut: Ctrl+Shift+V to toggle video panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        toggleVideoPanel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleVideoPanel]);

  const canExecute = useMemo(() => {
    if (!room || !user) {
      return false;
    }
    return room.status !== "ENDED";
  }, [room, user]);

  const isRoomAdmin = useMemo(() => {
    if (!room || !user) {
      return false;
    }
    return room.createdBy === user.id;
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

        if (response.chatMessages && response.chatMessages.length > 0) {
          setChatMessages(response.chatMessages);
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

      if (message.type === "room-ended") {
        pushToast("Room has ended", "info");
        router.push("/");
        return;
      }

      if (message.type === "chat-message") {
        const newMessage: ChatMessage = {
          id: `${message.userId}-${message.timestamp}`,
          userId: message.userId,
          userName: message.userName,
          message: message.message,
          timestamp: message.timestamp,
        };
        setChatMessages((prev) => [...prev, newMessage]);
        // Only increment unread if not viewing chat tab
        setUnreadChatCount((prev) => prev + 1);
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
  }, [accessToken, pushToast, roomId, router]);

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
      await apiRequest<{ room: RoomResponse["room"] }>(`/rooms/${roomId}/end`, {
        method: "PATCH",
        accessToken,
      });
      pushToast("Room ended", "success");
      router.push("/");
    } catch (endError) {
      setError(endError instanceof Error ? endError.message : "Failed to end room");
    }
  };

  // Show error states
  if (roomNotFound) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-nc-body">
        <h1 className="text-xl font-semibold text-nc-text">Room Not Found</h1>
        <p className="text-nc-text-secondary">The room you&apos;re looking for doesn&apos;t exist or has been deleted.</p>
        <button
          type="button"
          className="rounded border border-nc-border bg-nc-card px-4 py-2 text-sm text-nc-text transition hover:bg-nc-card-hover"
          onClick={() => router.push("/")}
        >
          Back to Home
        </button>
      </div>
    );
  }

  if (error && !room) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-nc-body">
        <h1 className="text-xl font-semibold text-nc-error">Error</h1>
        <p className="text-nc-text-secondary">{error}</p>
        <button
          type="button"
          className="rounded border border-nc-border bg-nc-card px-4 py-2 text-sm text-nc-text transition hover:bg-nc-card-hover"
          onClick={() => router.push("/")}
        >
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <AppShell
      roomId={roomId}
      connectionState={connectionState}
      userCount={presence?.userCount ?? 0}
      userEmail={user?.email ?? ""}
      onLogout={logout}
    >
      <Group orientation="horizontal" className="h-full">
        {/* Main workspace area */}
        <Panel id="workspace" defaultSize="75%" minSize="50%">
          <div className="flex h-full flex-col">
            {/* Editor Toolbar */}
            <EditorToolbar
              language={language}
              onLanguageChange={setLanguage}
              onRun={() => void runCode()}
              onEndRoom={() => void endRoom()}
              onToggleVideo={toggleVideoPanel}
              canExecute={canExecute}
              canEndRoom={isRoomAdmin}
              isRunning={executionState === "running"}
              isRoomEnded={room?.status === "ENDED"}
              isVideoVisible={!videoCollapsed}
              charCount={sourceCode.length}
              maxChars={maxSourceCodeLength}
            />

            {/* Split Pane: Editor (top) + Output (bottom) - VS Code style */}
            <Group orientation="vertical" className="flex-1">
              {/* Editor Panel - Top */}
              <Panel id="editor" defaultSize="70%" minSize="30%">
                <div className="h-full bg-nc-editor">
                  <CodeEditor
                    language={language}
                    value={sourceCode}
                    onChange={onEditorChange}
                    onEditorMount={(instance) => {
                      editorRef.current = instance;
                    }}
                  />
                </div>
              </Panel>

              {/* Horizontal Resize Handle */}
              <Separator className="group relative h-1.5 bg-nc-border transition hover:bg-nc-primary data-[resize-handle-state=drag]:bg-nc-primary">
                <div className="absolute inset-x-0 -top-1 -bottom-1 cursor-row-resize" />
              </Separator>

              {/* Output/Chat Panel - Bottom */}
              <Panel id="output" defaultSize="30%" minSize="15%">
                <div className="flex h-full flex-col bg-nc-editor">
                  {/* Tabs */}
                  <div className="flex shrink-0 border-b border-nc-border">
                    <button
                      type="button"
                      onClick={switchToOutput}
                      className={`px-4 py-2 text-sm font-medium transition ${
                        bottomTab === "output"
                          ? "border-b-2 border-nc-primary text-nc-text"
                          : "text-nc-text-secondary hover:text-nc-text"
                      }`}
                    >
                      Output
                      {executionState === "running" && (
                        <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-nc-warning" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={switchToChat}
                      className={`px-4 py-2 text-sm font-medium transition ${
                        bottomTab === "chat"
                          ? "border-b-2 border-nc-primary text-nc-text"
                          : "text-nc-text-secondary hover:text-nc-text"
                      }`}
                    >
                      Chat
                      {unreadChatCount > 0 && bottomTab !== "chat" && (
                        <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-nc-primary px-1.5 text-xs text-white">
                          {unreadChatCount > 99 ? "99+" : unreadChatCount}
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Tab Content */}
                  <div className="flex-1 overflow-hidden">
                    {bottomTab === "output" ? (
                      <OutputPanel
                        output={output}
                        executionState={executionState}
                        history={executionHistory}
                      />
                    ) : (
                      <ChatPanel
                        messages={chatMessages}
                        currentUserId={user?.id ?? ""}
                        onSendMessage={sendChatMessage}
                      />
                    )}
                  </div>
                </div>
              </Panel>
            </Group>
          </div>
        </Panel>

        {/* Video Panel Resize Handle */}
        <Separator className="group relative w-1.5 bg-nc-border transition hover:bg-nc-primary data-[resize-handle-state=drag]:bg-nc-primary">
          <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
        </Separator>

        {/* Video Panel Sidebar - Collapsible & Resizable */}
        {user?.id && (
          <Panel
            id="video"
            panelRef={videoPanelRef}
            defaultSize="30%"
            minSize="20%"
            maxSize="50%"
            collapsible
            collapsedSize="0%"
          >
            <VideoPanel
              roomId={roomId}
              accessToken={accessToken}
              currentUserId={user.id}
              isCollapsed={videoCollapsed}
              onToggleCollapse={toggleVideoPanel}
            />
          </Panel>
        )}
      </Group>
    </AppShell>
  );
};
