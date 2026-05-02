"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildWsUrl } from "../lib/ws";
import { useToast } from "./toast-provider";

type SignalPayload =
  | {
      type: "offer";
      roomId: string;
      sdp: RTCSessionDescriptionInit;
      fromUserId?: string;
    }
  | {
      type: "answer";
      roomId: string;
      sdp: RTCSessionDescriptionInit;
      fromUserId?: string;
    }
  | {
      type: "ice";
      roomId: string;
      candidate: RTCIceCandidateInit;
      fromUserId?: string;
    }
  | {
      type: "leave" | "renegotiate";
      roomId: string;
      fromUserId?: string;
    }
  | {
      type: "peer-joined" | "peer-left";
      roomId: string;
      userId: string;
      channel: string;
    }
  | {
      type: "error";
      message: string;
    };

type VideoCallPanelProps = {
  roomId: string;
  accessToken: string;
  currentUserId: string;
};

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export const VideoCallPanel = ({ roomId, accessToken, currentUserId }: VideoCallPanelProps) => {
  const signalSocketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteUserIdRef = useRef<string | null>(null);

  const [signalState, setSignalState] = useState<"connected" | "reconnecting" | "disconnected">("disconnected");
  const [callState, setCallState] = useState<"idle" | "connecting" | "connected" | "ended" | "error">("idle");
  const [mediaError, setMediaError] = useState("");
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [networkQuality, setNetworkQuality] = useState<"unknown" | "good" | "fair" | "poor">("unknown");
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState("");
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState("");
  const { pushToast } = useToast();

  const sendSignal = useCallback((payload: SignalPayload) => {
    const socket = signalSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(payload));
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audios = devices.filter((d) => d.kind === "audioinput");
      const videos = devices.filter((d) => d.kind === "videoinput");
      setAudioDevices(audios);
      setVideoDevices(videos);
      if (!selectedAudioDeviceId && audios[0]) {
        setSelectedAudioDeviceId(audios[0].deviceId);
      }
      if (!selectedVideoDeviceId && videos[0]) {
        setSelectedVideoDeviceId(videos[0].deviceId);
      }
    } catch {
      // no-op
    }
  }, [selectedAudioDeviceId, selectedVideoDeviceId]);

  const ensureLocalStream = useCallback(async () => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedAudioDeviceId ? { deviceId: { exact: selectedAudioDeviceId } } : true,
        video: selectedVideoDeviceId ? { deviceId: { exact: selectedVideoDeviceId } } : true,
      });

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setMediaError("");
      return stream;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to access camera/microphone";
      setMediaError(message);
      setCallState("error");
      throw error;
    }
  }, [selectedAudioDeviceId, selectedVideoDeviceId]);

  const clearPeerConnection = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (remoteStreamRef.current) {
      for (const track of remoteStreamRef.current.getTracks()) {
        track.stop();
      }
      remoteStreamRef.current = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  };

  const ensurePeerConnection = useCallback(async (remoteUserId: string) => {
    remoteUserIdRef.current = remoteUserId;
    if (peerConnectionRef.current) {
      return peerConnectionRef.current;
    }

    const pc = new RTCPeerConnection(rtcConfig);
    const localStream = await ensureLocalStream();
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      sendSignal({
        type: "ice",
        roomId,
        candidate: event.candidate.toJSON(),
      });
    };

    pc.ontrack = (event) => {
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }

      for (const track of event.streams[0]?.getTracks() ?? []) {
        remoteStreamRef.current.addTrack(track);
      }

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setCallState("connected");
        return;
      }

      if (["disconnected", "failed"].includes(pc.connectionState)) {
        setCallState("error");
        return;
      }

      if (pc.connectionState === "closed") {
        setCallState("ended");
      }
    };

    peerConnectionRef.current = pc;
    return pc;
  }, [ensureLocalStream, roomId, sendSignal]);

  const createOffer = useCallback(async (remoteUserId: string) => {
    try {
      setCallState("connecting");
      const pc = await ensurePeerConnection(remoteUserId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendSignal({
        type: "offer",
        roomId,
        sdp: offer,
      });
    } catch {
      setCallState("error");
    }
  }, [ensurePeerConnection, roomId, sendSignal]);

  const endCall = () => {
    sendSignal({ type: "leave", roomId });
    clearPeerConnection();
    setCallState("ended");
  };

  const renegotiate = async () => {
    sendSignal({ type: "renegotiate", roomId });
  };

  const replaceTrack = async (kind: "audio" | "video", deviceId: string) => {
    const constraints = kind === "audio" ? { audio: { deviceId: { exact: deviceId } }, video: false } : { audio: false, video: { deviceId: { exact: deviceId } } };
    const newStream = await navigator.mediaDevices.getUserMedia(constraints);
    const newTrack = kind === "audio" ? newStream.getAudioTracks()[0] : newStream.getVideoTracks()[0];
    if (!newTrack || !localStreamRef.current) {
      return;
    }

    const oldTrack = kind === "audio" ? localStreamRef.current.getAudioTracks()[0] : localStreamRef.current.getVideoTracks()[0];
    if (oldTrack) {
      localStreamRef.current.removeTrack(oldTrack);
      oldTrack.stop();
    }
    localStreamRef.current.addTrack(newTrack);

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }

    const sender = peerConnectionRef.current?.getSenders().find((s) => s.track?.kind === kind);
    if (sender) {
      await sender.replaceTrack(newTrack);
    }
  };

  useEffect(() => {
    const localStream = localStreamRef.current;
    if (!localStream) {
      return;
    }

    for (const track of localStream.getAudioTracks()) {
      track.enabled = micEnabled;
    }
  }, [micEnabled]);

  useEffect(() => {
    const localStream = localStreamRef.current;
    if (!localStream) {
      return;
    }

    for (const track of localStream.getVideoTracks()) {
      track.enabled = cameraEnabled;
    }
  }, [cameraEnabled]);

  useEffect(() => {
    if (!peerConnectionRef.current) {
      setNetworkQuality("unknown");
      return;
    }

    const interval = setInterval(async () => {
      const pc = peerConnectionRef.current;
      if (!pc) {
        return;
      }

      const stats = await pc.getStats();
      let rttMs: number | null = null;
      stats.forEach((report) => {
        const candidatePairReport = report as RTCStats & {
          state?: string;
          currentRoundTripTime?: number;
        };

        if (report.type === "candidate-pair" && candidatePairReport.state === "succeeded") {
          const value = candidatePairReport.currentRoundTripTime;
          if (typeof value === "number") {
            rttMs = value * 1000;
          }
        }
      });

      if (rttMs == null) {
        setNetworkQuality("unknown");
        return;
      }

      if (rttMs < 150) {
        setNetworkQuality("good");
      } else if (rttMs < 350) {
        setNetworkQuality("fair");
      } else {
        setNetworkQuality("poor");
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [callState]);

  useEffect(() => {
    if (callState === "error") {
      pushToast("Call failed. Check media permissions or network.", "error");
    }
  }, [callState, pushToast]);

  useEffect(() => {
    void refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
    };
  }, [refreshDevices]);

  useEffect(() => {
    if (!accessToken || !currentUserId) {
      return;
    }

    let active = true;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const shouldInitiateWith = (otherUserId: string) => {
      return currentUserId.localeCompare(otherUserId) < 0;
    };

    const handleSignalMessage = async (event: MessageEvent<string>) => {
      let message: SignalPayload;
      try {
        message = JSON.parse(event.data) as SignalPayload;
      } catch {
        return;
      }

      if (message.type === "peer-joined" && message.channel === "signal" && message.userId !== currentUserId) {
        if (shouldInitiateWith(message.userId)) {
          await createOffer(message.userId);
        }
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

      if (message.type === "renegotiate" && message.fromUserId) {
        await createOffer(message.fromUserId);
        return;
      }

      if (message.type === "offer" && message.sdp && message.fromUserId) {
        const pc = await ensurePeerConnection(message.fromUserId);
        await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal({ type: "answer", roomId, sdp: answer });
        setCallState("connecting");
        return;
      }

      if (message.type === "answer" && message.sdp && message.fromUserId) {
        const pc = await ensurePeerConnection(message.fromUserId);
        await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
        return;
      }

      if (message.type === "ice" && message.candidate && message.fromUserId) {
        const pc = await ensurePeerConnection(message.fromUserId);
        await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
      }
    };

    const scheduleReconnect = () => {
      if (!active) {
        return;
      }

      clearReconnectTimer();
      setSignalState("reconnecting");
      const delay = Math.min(10_000, 500 * 2 ** Math.min(reconnectAttemptRef.current, 6) + Math.floor(Math.random() * 300));
      reconnectTimerRef.current = setTimeout(() => {
        reconnectAttemptRef.current += 1;
        connectSignal();
      }, delay);
    };

    const connectSignal = () => {
      if (!active) {
        return;
      }

      const socket = new WebSocket(buildWsUrl("/ws/signal", roomId, accessToken));
      signalSocketRef.current = socket;

      socket.onopen = async () => {
        reconnectAttemptRef.current = 0;
        setSignalState("connected");
        try {
          await ensureLocalStream();
          await refreshDevices();
        } catch {
          // handled in ensureLocalStream
        }
      };

      socket.onmessage = (event) => {
        void handleSignalMessage(event);
      };

      socket.onerror = () => {
        socket.close();
      };

      socket.onclose = () => {
        if (!active) {
          return;
        }

        scheduleReconnect();
      };
    };

    setSignalState("reconnecting");
    connectSignal();

    const localVideoElement = localVideoRef.current;

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
        for (const track of localStreamRef.current.getTracks()) {
          track.stop();
        }
        localStreamRef.current = null;
      }

      if (localVideoElement) {
        localVideoElement.srcObject = null;
      }

      setSignalState("disconnected");
    };
  }, [accessToken, createOffer, currentUserId, ensureLocalStream, ensurePeerConnection, refreshDevices, roomId, sendSignal]);

  const signalTone = useMemo(() => {
    if (signalState === "connected") {
      return "text-emerald-700";
    }

    if (signalState === "reconnecting") {
      return "text-amber-700";
    }

    return "text-rose-700";
  }, [signalState]);

  const networkTone = useMemo(() => {
    if (networkQuality === "good") {
      return "text-emerald-700";
    }
    if (networkQuality === "fair") {
      return "text-amber-700";
    }
    if (networkQuality === "poor") {
      return "text-rose-700";
    }
    return "text-stone-600";
  }, [networkQuality]);

  const toggleScreenShare = async () => {
    if (!localStreamRef.current) {
      return;
    }

    if (screenSharing) {
      if (selectedVideoDeviceId) {
        await replaceTrack("video", selectedVideoDeviceId);
      }
      setScreenSharing(false);
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const displayTrack = displayStream.getVideoTracks()[0];
      if (!displayTrack) {
        return;
      }

      const oldTrack = localStreamRef.current.getVideoTracks()[0];
      if (oldTrack) {
        localStreamRef.current.removeTrack(oldTrack);
        oldTrack.stop();
      }
      localStreamRef.current.addTrack(displayTrack);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }

      const sender = peerConnectionRef.current?.getSenders().find((s) => s.track?.kind === "video");
      if (sender) {
        await sender.replaceTrack(displayTrack);
      }

      displayTrack.onended = () => {
        if (selectedVideoDeviceId) {
          void replaceTrack("video", selectedVideoDeviceId);
        }
        setScreenSharing(false);
      };

      setScreenSharing(true);
    } catch {
      setMediaError("Screen sharing failed or was cancelled");
    }
  };

  return (
    <section className="rounded-2xl border border-stone-200 bg-stone-50 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Live Call</h3>
        <span className={`rounded-full border border-stone-300 px-3 py-1 text-xs uppercase tracking-wide ${signalTone}`}>
          signal: {signalState}
        </span>
      </div>

      <p className="mb-3 text-sm text-stone-600">Call state: {callState}</p>
      <p className={`mb-3 text-sm ${networkTone}`}>Network: {networkQuality}</p>
      {mediaError ? <p className="mb-3 text-sm text-rose-700">{mediaError}</p> : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-stone-500">Local</p>
          <video ref={localVideoRef} autoPlay muted playsInline className="h-44 w-full rounded-xl bg-stone-900 object-cover" />
        </div>
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-stone-500">Remote</p>
          <video ref={remoteVideoRef} autoPlay playsInline className="h-44 w-full rounded-xl bg-stone-900 object-cover" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-sm text-stone-700 transition hover:bg-stone-200"
          onClick={() => setMicEnabled((prev) => !prev)}
        >
          {micEnabled ? "Mute Mic" : "Unmute Mic"}
        </button>
        <button
          type="button"
          className="rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-sm text-stone-700 transition hover:bg-stone-200"
          onClick={() => setCameraEnabled((prev) => !prev)}
        >
          {cameraEnabled ? "Camera Off" : "Camera On"}
        </button>
        <button
          type="button"
          className="rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-sm text-stone-700 transition hover:bg-stone-200"
          onClick={() => void toggleScreenShare()}
        >
          {screenSharing ? "Stop Share" : "Share Screen"}
        </button>
        <button
          type="button"
          className="rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-sm text-stone-700 transition hover:bg-stone-200"
          onClick={() => void renegotiate()}
        >
          Renegotiate
        </button>
        <button
          type="button"
          className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-800"
          onClick={endCall}
        >
          End Call
        </button>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <label className="text-xs uppercase tracking-wide text-stone-500">
          Mic Device
          <select
            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm normal-case text-stone-800"
            value={selectedAudioDeviceId}
            onChange={(event) => {
              const deviceId = event.target.value;
              setSelectedAudioDeviceId(deviceId);
              void replaceTrack("audio", deviceId);
            }}
          >
            {audioDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || "Microphone"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs uppercase tracking-wide text-stone-500">
          Camera Device
          <select
            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm normal-case text-stone-800"
            value={selectedVideoDeviceId}
            onChange={(event) => {
              const deviceId = event.target.value;
              setSelectedVideoDeviceId(deviceId);
              void replaceTrack("video", deviceId);
            }}
          >
            {videoDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || "Camera"}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
};
