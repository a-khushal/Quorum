"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { MonacoYjsBinding } from "../lib/monaco-yjs-binding";

import { buildWsUrl } from "../lib/ws";
import { useAuth } from "./auth-provider";
import { AppShell } from "./app-shell";
import { ChatDrawer, type ChatMessage } from "./chat-drawer";
import { CodeEditor } from "./code-editor";
import { EditorToolbar } from "./editor-toolbar";
import { OutputPanel } from "./output-panel";
import { useToast } from "./toast-provider";
import { VideoPanel } from "./video-panel";
import { Whiteboard } from "./whiteboard";

const VIDEO_COLLAPSED_KEY = "quorum_video_collapsed";
const CHAT_OPEN_KEY = "quorum_chat_open";
const WORKSPACE_VIEW_KEY = "quorum_workspace_view";
const EDITOR_THEME_KEY = "quorum_editor_theme";

type WorkspaceView = "code" | "whiteboard";
type EditorTheme = "vs-dark" | "light";

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
      userName: string;
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
    }
  | {
      type: "language-change";
      roomId: string;
      language: RoomLanguage;
      userId: string;
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

const userColors = [
  { color: "#30bced", light: "#30bced33" },
  { color: "#6eeb83", light: "#6eeb8333" },
  { color: "#ffbc42", light: "#ffbc4233" },
  { color: "#ecd444", light: "#ecd44433" },
  { color: "#ee6352", light: "#ee635233" },
  { color: "#9ac2c9", light: "#9ac2c933" },
  { color: "#8acb88", light: "#8acb8833" },
  { color: "#1be7ff", light: "#1be7ff33" },
] as const;

const getRandomColor = () => userColors[Math.floor(Math.random() * userColors.length)]!;

const CURSOR_STYLE_ID = "y-monaco-remote-cursors";

const updateRemoteCursorStyles = (awareness: awarenessProtocol.Awareness, localClientId: number) => {
  let styleEl = document.getElementById(CURSOR_STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = CURSOR_STYLE_ID;
    document.head.appendChild(styleEl);
  }

  let css = "";
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === localClientId) return;
    const user = state.user as { name?: string; color?: string; colorLight?: string } | undefined;
    if (!user) return;
    const color = user.color ?? "#30bced";
    const light = user.colorLight ?? `${color}33`;
    const name = (user.name ?? "").replace(/"/g, '\\"');
    css += `.yRemoteSelection-${clientId}{background-color:${light}}`;
    css += `.yRemoteSelectionHead-${clientId}{position:absolute;border-left:${color} solid 2px;border-top:${color} solid 2px;height:100%;box-sizing:border-box}`;
    css += `.yRemoteSelectionHead-${clientId}::after{content:"${name}";position:absolute;top:-1.4em;left:-2px;background:${color};color:#fff;font-size:10px;padding:1px 4px;border-radius:2px 2px 2px 0;white-space:nowrap;pointer-events:none;font-family:var(--font-geist-mono),monospace;opacity:0.9}`;
  });
  styleEl.textContent = css;
};

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
  const { accessToken, user, logout, authRequest } = useAuth();
  const [room, setRoom] = useState<RoomResponse["room"] | null>(null);
  const [presence, setPresence] = useState<RoomResponse["presence"] | null>(null);
  const [sourceCode, setSourceCode] = useState(defaultTemplates.TYPESCRIPT);
  const [language, setLanguage] = useState<RoomLanguage>("TYPESCRIPT");
  const [output, setOutput] = useState("Waiting for execution...");
  const [stdin, setStdin] = useState("");
  const [executionState, setExecutionState] = useState<"idle" | "running" | "success" | "error">("idle");
  const [connectionState, setConnectionState] = useState<"connected" | "reconnecting" | "disconnected">("disconnected");
  const [error, setError] = useState("");
  const [roomNotFound, setRoomNotFound] = useState(false);
  const relaySocketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const yjsSocketRef = useRef<WebSocket | null>(null);
  const yjsReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const yjsReconnectAttemptRef = useRef(0);
  const yDocRef = useRef<Y.Doc | null>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  const awarenessRef = useRef<awarenessProtocol.Awareness | null>(null);
  const bindingRef = useRef<MonacoYjsBinding | null>(null);
  const createBindingRef = useRef<(() => void) | null>(null);
  const recentRequestIdsRef = useRef<Set<string>>(new Set());
  const previousConnectionStateRef = useRef<"connected" | "reconnecting" | "disconnected">("disconnected");
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const hasSyncedYjsRef = useRef(false);
  const pendingInitialDraftRef = useRef<string | null>(null);
  const userColorRef = useRef(getRandomColor());
  const videoPanelRef = usePanelRef();
  const chatOpenRef = useRef(false);
  const [executionHistory, setExecutionHistory] = useState<Array<{ id: string; status: string; at: string }>>([]);
  const [videoCollapsed, setVideoCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(VIDEO_COLLAPSED_KEY) === "true";
    }
    return false; // Default: expanded
  });
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [editorReady, setEditorReady] = useState(false);
  const [chatOpen, setChatOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(CHAT_OPEN_KEY) === "true";
    }
    return false;
  });
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [participants, setParticipants] = useState<Map<string, string>>(new Map());
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(WORKSPACE_VIEW_KEY);
      return saved === "whiteboard" ? "whiteboard" : "code";
    }
    return "code";
  });
  const [editorTheme, setEditorTheme] = useState<EditorTheme>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(EDITOR_THEME_KEY) === "light" ? "light" : "vs-dark";
    }
    return "vs-dark";
  });
  const { pushToast } = useToast();

  const handleViewChange = useCallback((view: WorkspaceView) => {
    setWorkspaceView(view);
    localStorage.setItem(WORKSPACE_VIEW_KEY, view);
  }, []);

  const handleThemeChange = useCallback((theme: EditorTheme) => {
    setEditorTheme(theme);
    localStorage.setItem(EDITOR_THEME_KEY, theme);
  }, []);

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

  const handleLanguageChange = useCallback(
    (newLanguage: RoomLanguage) => {
      setLanguage(newLanguage);

      const ws = relaySocketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !user) return;

      const languageEvent = {
        type: "language-change",
        roomId,
        language: newLanguage,
        userId: user.id,
      };
      ws.send(JSON.stringify(languageEvent));
    },
    [roomId, user],
  );

  const toggleChat = useCallback(() => {
    setChatOpen((prev) => {
      const next = !prev;
      chatOpenRef.current = next;
      localStorage.setItem(CHAT_OPEN_KEY, String(next));
      if (next) {
        setUnreadChatCount(0);
      }
      return next;
    });
  }, []);

  // Restore collapsed state from localStorage on mount
  useEffect(() => {
    if (videoCollapsed && videoPanelRef.current) {
      videoPanelRef.current.collapse();
    }
    chatOpenRef.current = chatOpen;
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
        const response = await authRequest<RoomResponse>(`/rooms/${roomId}`);
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
        if (!chatOpenRef.current) {
          setUnreadChatCount((prev) => prev + 1);
        }
        return;
      }

      if (message.type === "language-change") {
        if (message.userId !== user?.id && languages.includes(message.language)) {
          setLanguage(message.language);
        }
        return;
      }

      if (message.type === "peer-joined") {
        setParticipants((prev) => {
          const next = new Map(prev);
          next.set(message.userId, message.userName);
          return next;
        });
        setPresence((prev) => prev ? { ...prev, userCount: prev.userCount + 1 } : prev);
        return;
      }

      if (message.type === "peer-left") {
        setParticipants((prev) => {
          const next = new Map(prev);
          next.delete(message.userId);
          return next;
        });
        setPresence((prev) => prev ? { ...prev, userCount: Math.max(1, prev.userCount - 1) } : prev);
        return;
      }
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
const response = await authRequest<RoomResponse>(`/rooms/${roomId}`);
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
    if (!accessToken || !user) {
      return;
    }

    let active = true;

    const MSG_TYPE_DOC = 0;
    const MSG_TYPE_AWARENESS = 1;

    const yDoc = new Y.Doc();
    const yText = yDoc.getText("source");
    const awareness = new awarenessProtocol.Awareness(yDoc);
    hasSyncedYjsRef.current = false;
    yDocRef.current = yDoc;
    yTextRef.current = yText;
    awarenessRef.current = awareness;

    // Set local awareness state (username + color)
    const uColor = userColorRef.current;
    const userName = user.email?.split("@")[0] ?? "User";
    awareness.setLocalStateField("user", {
      name: userName,
      color: uColor.color,
      colorLight: uColor.light,
    });

    // --- MonacoBinding creation ---
    // Called when both editor instance and Yjs are ready
    const tryCreateBinding = () => {
      if (bindingRef.current) return;
      const ed = editorRef.current;
      if (!ed) return;
      const model = ed.getModel();
      if (!model) return;

      bindingRef.current = new MonacoYjsBinding(
        yText,
        model,
        ed,
        awareness,
      );
    };
    createBindingRef.current = tryCreateBinding;

    // Keep sourceCode state in sync for char counter, draft persistence, execution
    const onYTextSync = () => {
      setSourceCode(yText.toString());
    };
    yText.observe(onYTextSync);

    // --- Yjs doc update → send over WS (uses ref so reconnected sockets work) ---
    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "ws-sync") return;
      const sock = yjsSocketRef.current;
      if (sock && sock.readyState === WebSocket.OPEN) {
        const msg = new Uint8Array(update.length + 1);
        msg[0] = MSG_TYPE_DOC;
        msg.set(update, 1);
        sock.send(msg);
      }
    };
    yDoc.on("update", onDocUpdate);

    // --- Awareness update → send over WS (uses ref) ---
    const onAwarenessUpdate = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === "ws-sync") return;
      const changed = [...added, ...updated, ...removed];
      if (changed.length === 0) return;
      const sock = yjsSocketRef.current;
      if (sock && sock.readyState === WebSocket.OPEN) {
        const enc = awarenessProtocol.encodeAwarenessUpdate(awareness, changed);
        const msg = new Uint8Array(enc.length + 1);
        msg[0] = MSG_TYPE_AWARENESS;
        msg.set(enc, 1);
        sock.send(msg);
      }
    };
    awareness.on("update", onAwarenessUpdate);

    // Rerender cursor CSS + update typing indicators when awareness changes
    const onAwarenessChange = () => {
      updateRemoteCursorStyles(awareness, yDoc.clientID);

      const typing: string[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === yDoc.clientID) return;
        if (state.isTyping) {
          const u = state.user as { name?: string } | undefined;
          typing.push(u?.name ?? "Someone");
        }
      });
      setTypingUsers(typing);
    };
    awareness.on("change", onAwarenessChange);

    // --- Reconnection logic ---
    const clearYjsReconnectTimer = () => {
      if (yjsReconnectTimerRef.current) {
        clearTimeout(yjsReconnectTimerRef.current);
        yjsReconnectTimerRef.current = null;
      }
    };

    const scheduleYjsReconnect = () => {
      if (!active) return;
      clearYjsReconnectTimer();
      const delay = Math.min(10_000, 500 * 2 ** Math.min(yjsReconnectAttemptRef.current, 6) + Math.random() * 300);
      yjsReconnectTimerRef.current = setTimeout(() => {
        yjsReconnectAttemptRef.current += 1;
        connectYjsSocket();
      }, delay);
    };

    // --- WebSocket connection (called on initial connect and reconnect) ---
    const connectYjsSocket = () => {
      if (!active) return;

      const ws = new WebSocket(buildWsUrl("/ws/yjs", roomId, accessToken));
      ws.binaryType = "arraybuffer";
      yjsSocketRef.current = ws;

      ws.onopen = () => {
        yjsReconnectAttemptRef.current = 0;

        // Send initial awareness so the server and peers know about us
        const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]);
        const msg = new Uint8Array(awarenessUpdate.length + 1);
        msg[0] = MSG_TYPE_AWARENESS;
        msg.set(awarenessUpdate, 1);
        ws.send(msg);

        setTimeout(() => {
          if (!hasSyncedYjsRef.current) {
            if (yText.length === 0) {
              let draft = pendingInitialDraftRef.current;
              if (!draft) {
                try { draft = window.localStorage.getItem(getDraftKey(roomId)); } catch { draft = null; }
              }
              if (draft) {
                applyTextDiff(yText, draft);
              }
            }
            pendingInitialDraftRef.current = null;
            hasSyncedYjsRef.current = true;
            setEditorReady(true);
            tryCreateBinding();
          }
        }, 500);
      };

      ws.onmessage = (event) => {
        if (typeof event.data === "string") return;

        const data = event.data;
        let raw: Uint8Array;
        if (data instanceof ArrayBuffer) {
          raw = new Uint8Array(data);
        } else if (data instanceof Blob) {
          return;
        } else {
          raw = new Uint8Array(data as ArrayBufferLike);
        }

        if (raw.byteLength < 2) return;

        const msgType = raw[0];
        const payload = raw.slice(1);

        if (msgType === MSG_TYPE_DOC) {
          try {
            Y.applyUpdate(yDoc, payload, "ws-sync");
            hasSyncedYjsRef.current = true;

            if (yText.length === 0) {
              let draft = pendingInitialDraftRef.current;
              if (!draft) {
                try { draft = window.localStorage.getItem(getDraftKey(roomId)); } catch { draft = null; }
              }
              if (draft) {
                applyTextDiff(yText, draft);
              }
            }
            pendingInitialDraftRef.current = null;
            setEditorReady(true);
            tryCreateBinding();
          } catch {
            return;
          }
        } else if (msgType === MSG_TYPE_AWARENESS) {
          try {
            awarenessProtocol.applyAwarenessUpdate(awareness, payload, "ws-sync");
          } catch {
            // invalid awareness update
          }
        }
      };

      ws.onerror = () => {
        ws.close();
      };

      ws.onclose = () => {
        if (active) {
          scheduleYjsReconnect();
        }
      };
    };

    // Start the initial connection
    connectYjsSocket();

    return () => {
      active = false;
      clearYjsReconnectTimer();

      // Destroy binding first
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
      createBindingRef.current = null;

      yText.unobserve(onYTextSync);
      yDoc.off("update", onDocUpdate);
      awareness.off("update", onAwarenessUpdate);
      awareness.off("change", onAwarenessChange);
      awareness.destroy();

      const currentSocket = yjsSocketRef.current;
      yjsSocketRef.current = null;
      if (currentSocket) {
        currentSocket.onopen = null;
        currentSocket.onclose = null;
        currentSocket.onerror = null;
        currentSocket.onmessage = null;
        currentSocket.close();
      }

      yTextRef.current = null;
      yDocRef.current = null;
      awarenessRef.current = null;
      hasSyncedYjsRef.current = false;
      yjsReconnectAttemptRef.current = 0;
      pendingInitialDraftRef.current = null;
      setEditorReady(false);

      // Clean up cursor styles
      const styleEl = document.getElementById(CURSOR_STYLE_ID);
      if (styleEl) styleEl.textContent = "";
    };
  }, [accessToken, roomId, user]);

  useEffect(() => {
    window.localStorage.setItem(getDraftKey(roomId), sourceCode);
  }, [roomId, sourceCode]);

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
      const result = await authRequest<{ type: string; stdout?: string; message?: string; status?: string; requestId?: string }>("/execute", {
        method: "POST",
        body: {
          roomId,
          language,
          sourceCode,
          stdin: stdin || undefined,
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
      await authRequest<{ room: RoomResponse["room"] }>(`/rooms/${roomId}/end`, {
        method: "PATCH",
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

  const currentUserName = user?.email?.split("@")[0] ?? "You";
  const participantNames = useMemo(() => {
    const names = [currentUserName];
    for (const name of participants.values()) {
      if (name !== currentUserName) {
        names.push(name);
      }
    }
    return names;
  }, [participants, currentUserName]);

  return (
    <AppShell
      roomId={roomId}
      connectionState={connectionState}
      userCount={presence?.userCount ?? 0}
      userEmail={user?.email ?? ""}
      participants={participantNames}
      onLogout={logout}
    >
      <div className="flex h-full">
        <Group orientation="horizontal" className="h-full flex-1">
        {/* Main workspace area */}
        <Panel id="workspace" defaultSize="75%" minSize="50%">
          <div className="flex h-full flex-col">
            {/* Editor Toolbar */}
            <EditorToolbar
              language={language}
              onLanguageChange={handleLanguageChange}
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
              currentView={workspaceView}
              onViewChange={handleViewChange}
              typingUsers={typingUsers}
              editorTheme={editorTheme}
              onThemeChange={handleThemeChange}
            />

            {workspaceView === "whiteboard" ? (
              <div className="flex-1 overflow-hidden">
                <Whiteboard roomId={roomId} accessToken={accessToken} />
              </div>
            ) : (
              <Group orientation="vertical" className="flex-1">
                {/* Editor Panel - Top */}
                <Panel id="editor" defaultSize="70%" minSize="30%">
                  <div className="h-full bg-nc-editor">
                    <CodeEditor
                      language={language}
                      defaultValue={sourceCode}
                      onEditorMount={(instance) => {
                        editorRef.current = instance;
                        createBindingRef.current?.();
                      }}
                      onRun={() => {
                        if (canExecute && executionState !== "running" && room?.status !== "ENDED") {
                          void runCode();
                        }
                      }}
                      readOnly={!editorReady}
                      editorTheme={editorTheme}
                    />
                  </div>
                </Panel>

                {/* Horizontal Resize Handle */}
                <Separator className="group relative h-1.5 bg-nc-border transition hover:bg-nc-primary data-[resize-handle-state=drag]:bg-nc-primary">
                  <div className="absolute inset-x-0 -top-1 -bottom-1 cursor-row-resize" />
                </Separator>

                {/* Output Panel - Bottom */}
                <Panel id="output" defaultSize="30%" minSize="15%">
                  <div className="flex h-full flex-col bg-nc-editor">
                    {/* Header */}
                    <div className="flex shrink-0 items-center border-b border-nc-border px-4 py-2">
                      <span className="text-sm font-medium text-nc-text">Output</span>
                      {executionState === "running" && (
                        <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-nc-warning" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-hidden">
                      <OutputPanel
                        output={output}
                        executionState={executionState}
                        history={executionHistory}
                        stdin={stdin}
                        onStdinChange={setStdin}
                      />
                    </div>
                  </div>
                </Panel>
              </Group>
            )}
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
              currentUserName={user.email?.split("@")[0] ?? "You"}
              isCollapsed={videoCollapsed}
              onToggleCollapse={toggleVideoPanel}
              isChatOpen={chatOpen}
              onToggleChat={toggleChat}
              unreadChatCount={unreadChatCount}
            />
          </Panel>
        )}
        </Group>

        {/* Chat Drawer - slides in from right */}
        {user?.id && (
          <ChatDrawer
            isOpen={chatOpen}
            onClose={toggleChat}
            messages={chatMessages}
            currentUserId={user.id}
            onSendMessage={sendChatMessage}
          />
        )}
      </div>
    </AppShell>
  );
};
