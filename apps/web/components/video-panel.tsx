"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buildWsUrl } from "../lib/ws";
import { useToast } from "./toast-provider";

type SignalPayload =
  | { type: "offer"; roomId: string; sdp: RTCSessionDescriptionInit; fromUserId?: string }
  | { type: "answer"; roomId: string; sdp: RTCSessionDescriptionInit; fromUserId?: string }
  | { type: "ice"; roomId: string; candidate: RTCIceCandidateInit; fromUserId?: string }
  | { type: "leave" | "renegotiate"; roomId: string; fromUserId?: string }
  | { type: "peer-joined" | "peer-left"; roomId: string; userId: string; channel: string }
  | { type: "error"; message: string };

type VideoPanelProps = {
  roomId: string;
  accessToken: string;
  currentUserId: string;
  isCollapsed?: boolean;
  onToggleCollapse: () => void;
};

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export const VideoPanel = ({
  roomId,
  accessToken,
  currentUserId,
  isCollapsed = false,
  onToggleCollapse,
}: VideoPanelProps) => {
  const signalSocketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteUserIdRef = useRef<string | null>(null);
  const makingOfferRef = useRef(false);
  const ignoredOfferRef = useRef(false);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const [signalState, setSignalState] = useState<"connected" | "reconnecting" | "disconnected">("disconnected");
  const [callState, setCallState] = useState<"idle" | "connecting" | "connected" | "ended" | "error">("idle");
  const [mediaError, setMediaError] = useState("");
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState("");
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState("");
  const [showDevices, setShowDevices] = useState(false);
  const { pushToast } = useToast();

  const sendSignal = useCallback((payload: SignalPayload) => {
    const socket = signalSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioDevices(devices.filter((d) => d.kind === "audioinput"));
      setVideoDevices(devices.filter((d) => d.kind === "videoinput"));
    } catch {
      // no-op
    }
  }, []);

  const ensureLocalStream = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError("Camera/microphone not supported");
      setCallState("error");
      throw new Error("Not supported");
    }

    if (localStreamRef.current) return localStreamRef.current;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedAudioDeviceId ? { deviceId: { exact: selectedAudioDeviceId } } : true,
        video: selectedVideoDeviceId ? { deviceId: { exact: selectedVideoDeviceId } } : true,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setMediaError("");
      return stream;
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "Camera/mic access denied");
      setCallState("error");
      throw error;
    }
  }, [selectedAudioDeviceId, selectedVideoDeviceId]);

  const clearPeerConnection = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((t) => t.stop());
      remoteStreamRef.current = null;
    }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    pendingIceCandidatesRef.current = [];
    makingOfferRef.current = false;
    ignoredOfferRef.current = false;
  }, []);

  const ensurePeerConnection = useCallback(
    async (remoteUserId: string) => {
      remoteUserIdRef.current = remoteUserId;
      if (peerConnectionRef.current) return peerConnectionRef.current;

      const pc = new RTCPeerConnection(rtcConfig);
      const localStream = await ensureLocalStream();
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal({ type: "ice", roomId, candidate: event.candidate.toJSON() });
        }
      };

      pc.ontrack = (event) => {
        if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream();
        event.streams[0]?.getTracks().forEach((track) => remoteStreamRef.current!.addTrack(track));
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStreamRef.current;
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") setCallState("connected");
        else if (["disconnected", "failed"].includes(pc.connectionState)) setCallState("error");
        else if (pc.connectionState === "closed") setCallState("ended");
      };

      peerConnectionRef.current = pc;
      return pc;
    },
    [ensureLocalStream, roomId, sendSignal]
  );

  const createOffer = useCallback(
    async (remoteUserId: string) => {
      try {
        setCallState("connecting");
        const pc = await ensurePeerConnection(remoteUserId);
        if (pc.signalingState !== "stable") return;

        makingOfferRef.current = true;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal({ type: "offer", roomId, sdp: offer });
      } catch {
        setCallState("error");
      } finally {
        makingOfferRef.current = false;
      }
    },
    [ensurePeerConnection, roomId, sendSignal]
  );

  const endCall = useCallback(() => {
    sendSignal({ type: "leave", roomId });
    clearPeerConnection();
    setCallState("ended");
  }, [clearPeerConnection, roomId, sendSignal]);

  const replaceTrack = useCallback(async (kind: "audio" | "video", deviceId: string) => {
    const constraints = kind === "audio" 
      ? { audio: { deviceId: { exact: deviceId } }, video: false } 
      : { audio: false, video: { deviceId: { exact: deviceId } } };
    
    const newStream = await navigator.mediaDevices.getUserMedia(constraints);
    const newTrack = kind === "audio" ? newStream.getAudioTracks()[0] : newStream.getVideoTracks()[0];
    if (!newTrack || !localStreamRef.current) return;

    const oldTrack = kind === "audio" 
      ? localStreamRef.current.getAudioTracks()[0] 
      : localStreamRef.current.getVideoTracks()[0];
    
    if (oldTrack) {
      localStreamRef.current.removeTrack(oldTrack);
      oldTrack.stop();
    }
    localStreamRef.current.addTrack(newTrack);
    if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;

    const sender = peerConnectionRef.current?.getSenders().find((s) => s.track?.kind === kind);
    if (sender) await sender.replaceTrack(newTrack);
  }, []);

  // Toggle mic
  useEffect(() => {
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = micEnabled));
  }, [micEnabled]);

  // Toggle camera
  useEffect(() => {
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = cameraEnabled));
  }, [cameraEnabled]);

  // Call state toast
  useEffect(() => {
    if (callState === "error") pushToast("Call failed", "error");
  }, [callState, pushToast]);

  // Device change listener
  useEffect(() => {
    void refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  // WebSocket connection
  useEffect(() => {
    if (!accessToken || !currentUserId) return;

    let active = true;
    const localVideoElement = localVideoRef.current;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const handleSignalMessage = async (event: MessageEvent<string>) => {
      let message: SignalPayload;
      try {
        message = JSON.parse(event.data) as SignalPayload;
      } catch {
        return;
      }

      if (message.type === "peer-joined" && message.channel === "signal" && message.userId !== currentUserId) {
        await createOffer(message.userId);
        return;
      }

      if (message.type === "peer-left" && message.channel === "signal" && message.userId !== currentUserId) {
        clearPeerConnection();
        setCallState("ended");
        return;
      }

      if (message.type === "leave" && message.fromUserId) {
        clearPeerConnection();
        setCallState("ended");
        return;
      }

      if (message.type === "offer" && message.sdp && message.fromUserId) {
        const pc = await ensurePeerConnection(message.fromUserId);
        const polite = currentUserId.localeCompare(message.fromUserId) > 0;
        const offerCollision = makingOfferRef.current || pc.signalingState !== "stable";
        ignoredOfferRef.current = !polite && offerCollision;

        if (ignoredOfferRef.current) return;
        if (offerCollision) await pc.setLocalDescription({ type: "rollback" });

        await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
        for (const c of pendingIceCandidatesRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        }
        pendingIceCandidatesRef.current = [];

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal({ type: "answer", roomId, sdp: answer });
        setCallState("connecting");
        return;
      }

      if (message.type === "answer" && message.sdp && message.fromUserId) {
        const pc = await ensurePeerConnection(message.fromUserId);
        if (pc.signalingState !== "have-local-offer") return;

        await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
        for (const c of pendingIceCandidatesRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        }
        pendingIceCandidatesRef.current = [];
        return;
      }

      if (message.type === "ice" && message.candidate && message.fromUserId) {
        if (ignoredOfferRef.current) return;
        const pc = await ensurePeerConnection(message.fromUserId);
        if (!pc.remoteDescription) {
          pendingIceCandidatesRef.current.push(message.candidate);
          return;
        }
        await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
      }
    };

    const scheduleReconnect = () => {
      if (!active) return;
      clearReconnectTimer();
      setSignalState("reconnecting");
      const delay = Math.min(10_000, 500 * 2 ** Math.min(reconnectAttemptRef.current, 6) + Math.random() * 300);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectAttemptRef.current += 1;
        connectSignal();
      }, delay);
    };

    const connectSignal = () => {
      if (!active) return;
      const socket = new WebSocket(buildWsUrl("/ws/signal", roomId, accessToken));
      signalSocketRef.current = socket;

      socket.onopen = async () => {
        reconnectAttemptRef.current = 0;
        setSignalState("connected");
        try {
          await ensureLocalStream();
          await refreshDevices();
        } catch {
          // handled
        }
      };

      socket.onmessage = (event) => {
        void handleSignalMessage(event).catch(() => setCallState("error"));
      };

      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (active) scheduleReconnect();
      };
    };

    setSignalState("reconnecting");
    connectSignal();

    return () => {
      active = false;
      clearReconnectTimer();
      if (signalSocketRef.current) {
        signalSocketRef.current.onopen = null;
        signalSocketRef.current.onmessage = null;
        signalSocketRef.current.onerror = null;
        signalSocketRef.current.onclose = null;
        signalSocketRef.current.close();
        signalSocketRef.current = null;
      }
      clearPeerConnection();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      if (localVideoElement) localVideoElement.srcObject = null;
      setSignalState("disconnected");
    };
  }, [accessToken, clearPeerConnection, createOffer, currentUserId, ensureLocalStream, ensurePeerConnection, refreshDevices, roomId, sendSignal]);

  const toggleScreenShare = async () => {
    if (!localStreamRef.current) return;

    if (screenSharing) {
      if (selectedVideoDeviceId) await replaceTrack("video", selectedVideoDeviceId);
      setScreenSharing(false);
      return;
    }

    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        setMediaError("Screen sharing not supported");
        return;
      }

      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const displayTrack = displayStream.getVideoTracks()[0];
      if (!displayTrack) return;

      const oldTrack = localStreamRef.current.getVideoTracks()[0];
      if (oldTrack) {
        localStreamRef.current.removeTrack(oldTrack);
        oldTrack.stop();
      }
      localStreamRef.current.addTrack(displayTrack);
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;

      const sender = peerConnectionRef.current?.getSenders().find((s) => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(displayTrack);

      displayTrack.onended = () => {
        if (selectedVideoDeviceId) void replaceTrack("video", selectedVideoDeviceId);
        setScreenSharing(false);
      };

      setScreenSharing(true);
    } catch {
      setMediaError("Screen sharing cancelled");
    }
  };

  const signalDot = signalState === "connected" ? "bg-nc-success" : signalState === "reconnecting" ? "bg-nc-warning" : "bg-nc-error";

  useEffect(() => {
    if (isCollapsed) return;
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
    if (remoteVideoRef.current && remoteStreamRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }
  }, [isCollapsed]);

  if (isCollapsed) {
    return <div className="h-full w-full bg-nc-body" />;
  }

  // Expanded view - full panel with stacked videos (Google Meet style)
  return (
    <div className="flex h-full w-full flex-col bg-nc-body">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-nc-border px-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-nc-text">Video</span>
          <span className={`h-2 w-2 rounded-full ${signalDot}`} />
          <span className="text-xs text-nc-text-muted">{callState}</span>
        </div>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex h-6 w-6 items-center justify-center rounded text-nc-text-muted transition hover:bg-nc-card-hover hover:text-nc-text"
          title="Collapse video panel (Ctrl+Shift+V)"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Error message */}
      {mediaError && (
        <div className="border-b border-nc-border bg-nc-error/10 px-3 py-2 text-xs text-nc-error">
          {mediaError}
        </div>
      )}

      {/* Video area - Stacked layout */}
      <div className="flex flex-1 flex-col gap-2 overflow-hidden p-2">
        {/* Remote video */}
        <div className="relative flex-1 overflow-hidden rounded-lg bg-nc-editor">
          <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover" />
          <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
            Remote
          </span>
        </div>
        {/* Local video */}
        <div className="relative flex-1 overflow-hidden rounded-lg bg-nc-editor">
          <video ref={localVideoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
          <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
            You
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-2 border-t border-nc-border px-3 py-2">
        <button
          type="button"
          onClick={() => setMicEnabled((p) => !p)}
          className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
            micEnabled ? "bg-nc-card-hover text-nc-text" : "bg-nc-error/20 text-nc-error"
          }`}
          title={micEnabled ? "Mute" : "Unmute"}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setCameraEnabled((p) => !p)}
          className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
            cameraEnabled ? "bg-nc-card-hover text-nc-text" : "bg-nc-error/20 text-nc-error"
          }`}
          title={cameraEnabled ? "Camera off" : "Camera on"}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => void toggleScreenShare()}
          className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
            screenSharing ? "bg-nc-primary/20 text-nc-primary" : "bg-nc-card-hover text-nc-text"
          }`}
          title={screenSharing ? "Stop sharing" : "Share screen"}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </button>
        <div className="mx-1 h-6 w-px bg-nc-border" />
        <button
          type="button"
          onClick={() => setShowDevices((p) => !p)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-nc-card-hover text-nc-text transition hover:text-nc-primary"
          title="Device settings"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={endCall}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-nc-error text-white transition hover:bg-nc-error/80"
          title="End call"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
          </svg>
        </button>
      </div>

      {/* Device selector dropdown */}
      {showDevices && (
        <div className="border-t border-nc-border px-3 py-2">
          <div className="grid gap-2">
            <label className="text-xs text-nc-text-muted">
              Microphone
              <select
                className="mt-1 w-full rounded border border-nc-border bg-nc-card-hover px-2 py-1.5 text-xs text-nc-text outline-none"
                value={selectedAudioDeviceId}
                onChange={(e) => {
                  setSelectedAudioDeviceId(e.target.value);
                  void replaceTrack("audio", e.target.value);
                }}
              >
                {audioDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || "Microphone"}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-nc-text-muted">
              Camera
              <select
                className="mt-1 w-full rounded border border-nc-border bg-nc-card-hover px-2 py-1.5 text-xs text-nc-text outline-none"
                value={selectedVideoDeviceId}
                onChange={(e) => {
                  setSelectedVideoDeviceId(e.target.value);
                  void replaceTrack("video", e.target.value);
                }}
              >
                {videoDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || "Camera"}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  );
};
