"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import * as Y from "yjs";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { ExcalidrawBinding, yjsToExcalidraw } from "y-excalidraw";
import * as awarenessProtocol from "y-protocols/awareness";

import { buildWsUrl } from "../lib/ws";

const Excalidraw = dynamic(
  async () => {
    const mod = await import("@excalidraw/excalidraw");
    return mod.Excalidraw;
  },
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-nc-editor text-nc-text-muted">
        Loading whiteboard...
      </div>
    ),
  }
);

type WhiteboardProps = {
  roomId: string;
  accessToken: string;
};

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

const getRandomColor = () => {
  const idx = Math.floor(Math.random() * userColors.length);
  return userColors[idx]!;
};

export const Whiteboard = ({ roomId, accessToken }: WhiteboardProps) => {
  const [cssLoaded, setCssLoaded] = useState(false);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [isReady, setIsReady] = useState(false);

  const excalidrawRef = useRef<HTMLDivElement>(null);
  const bindingRef = useRef<ExcalidrawBinding | null>(null);
  const yDocRef = useRef<Y.Doc | null>(null);
  const yElementsRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const yAssetsRef = useRef<Y.Map<unknown> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const awarenessRef = useRef<awarenessProtocol.Awareness | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const userColorRef = useRef(getRandomColor());

  useEffect(() => {
    const linkId = "excalidraw-css";
    if (document.getElementById(linkId)) {
      setCssLoaded(true);
      return;
    }

    const link = document.createElement("link");
    link.id = linkId;
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/@excalidraw/excalidraw@0.18.1/dist/prod/index.css";
    link.onload = () => setCssLoaded(true);
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    if (!accessToken || !cssLoaded) return;

    let active = true;
    const yDoc = new Y.Doc();
    const yElements = yDoc.getArray<Y.Map<unknown>>("elements");
    const yAssets = yDoc.getMap("assets");
    const awareness = new awarenessProtocol.Awareness(yDoc);

    yDocRef.current = yDoc;
    yElementsRef.current = yElements;
    yAssetsRef.current = yAssets;
    awarenessRef.current = awareness;

    const userColor = userColorRef.current;
    awareness.setLocalStateField("user", {
      name: "User " + Math.floor(Math.random() * 100),
      color: userColor.color,
      colorLight: userColor.light,
    });

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (!active) return;
      clearReconnectTimer();
      const delay = Math.min(10_000, 500 * 2 ** Math.min(reconnectAttemptRef.current, 6) + Math.random() * 300);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectAttemptRef.current += 1;
        connectSocket();
      }, delay);
    };

    const connectSocket = () => {
      if (!active) return;

      const ws = new WebSocket(buildWsUrl("/ws/yjs", `${roomId}-wb`, accessToken));
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
      };

      ws.onmessage = (event) => {
        if (typeof event.data === "string") return;

        const data = event.data;
        let update: Uint8Array;

        if (data instanceof ArrayBuffer) {
          update = new Uint8Array(data);
        } else {
          update = new Uint8Array(data as ArrayBufferLike);
        }

        if (update.byteLength === 0) return;

        try {
          Y.applyUpdate(yDoc, update, "ws-sync");
          if (!isReady) {
            setIsReady(true);
          }
        } catch {
          // Invalid update
        }
      };

      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (active) scheduleReconnect();
      };
    };

    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "ws-sync") return;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(update);
      }
    };

    yDoc.on("update", onDocUpdate);

    setTimeout(() => {
      if (active && !isReady) {
        setIsReady(true);
      }
    }, 300);

    connectSocket();

    return () => {
      active = false;
      clearReconnectTimer();
      yDoc.off("update", onDocUpdate);

      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      awareness.destroy();
      yDoc.destroy();
      yDocRef.current = null;
      yElementsRef.current = null;
      yAssetsRef.current = null;
      awarenessRef.current = null;
      setIsReady(false);
    };
  }, [accessToken, cssLoaded, roomId]);

  useEffect(() => {
    if (!api || !isReady || !yElementsRef.current || !yAssetsRef.current || !awarenessRef.current || !excalidrawRef.current) {
      return;
    }

    if (bindingRef.current) {
      return;
    }

    const yElements = yElementsRef.current;
    const yAssets = yAssetsRef.current;
    const awareness = awarenessRef.current;

    const binding = new ExcalidrawBinding(
      yElements,
      yAssets,
      api,
      awareness,
      {
        excalidrawDom: excalidrawRef.current,
        undoManager: new Y.UndoManager(yElements),
      }
    );

    bindingRef.current = binding;
  }, [api, isReady]);

  const handlePointerUpdate = useCallback(
    (payload: { pointer: { x: number; y: number; tool: "pointer" | "laser" }; button: "down" | "up" }) => {
      bindingRef.current?.onPointerUpdate?.(payload);
    },
    []
  );

  if (!cssLoaded || !isReady) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-nc-editor text-nc-text-muted">
        Loading whiteboard...
      </div>
    );
  }

  return (
    <div ref={excalidrawRef} className="excalidraw-wrapper" style={{ width: "100%", height: "100%" }}>
      <Excalidraw
        excalidrawAPI={setApi}
        onPointerUpdate={handlePointerUpdate}
        theme="dark"
        isCollaborating={true}
      />
    </div>
  );
};
