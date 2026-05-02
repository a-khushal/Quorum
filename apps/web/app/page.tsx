"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAuth } from "../components/auth-provider";
import { apiRequest } from "../lib/api";

type RoomLanguage = "TYPESCRIPT" | "PYTHON" | "JAVA" | "GO" | "CPP" | "C";

const languages: RoomLanguage[] = ["TYPESCRIPT", "PYTHON", "JAVA", "GO", "CPP", "C"];

export default function Home() {
  const router = useRouter();
  const { state, accessToken, user, logout } = useAuth();
  const [roomId, setRoomId] = useState("");
  const [language, setLanguage] = useState<RoomLanguage>("TYPESCRIPT");
  const [error, setError] = useState("");

  const createRoom = async () => {
    setError("");
    try {
      const response = await apiRequest<{ room: { id: string } }>("/rooms", {
        method: "POST",
        accessToken,
        body: { language },
      });
      router.push(`/room/${response.room.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create room");
    }
  };

  if (state === "loading") {
    return <main className="grid min-h-screen place-items-center text-stone-600">Loading...</main>;
  }

  if (state === "unauthenticated") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-5xl font-semibold tracking-tight">Quorum</h1>
        <p className="max-w-xl text-stone-600">Collaborative interview room with shared execution and real-time signaling.</p>
        <Link href="/auth" className="rounded-lg bg-teal-700 px-4 py-2 font-medium text-white transition hover:bg-teal-800">
          Login or Register
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-5xl font-semibold tracking-tight">Quorum</h1>
      <p className="text-sm text-stone-600">Signed in as {user?.email}</p>

      <section className="flex w-full max-w-2xl flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 shadow-sm">
        <h2 className="text-xl font-semibold">Create Room</h2>
        <div className="flex items-center gap-3">
          <label htmlFor="language">Language</label>
          <select
            id="language"
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
        <button
          type="button"
          className="rounded-lg bg-teal-700 px-4 py-2 font-medium text-white transition hover:bg-teal-800"
          onClick={() => void createRoom()}
        >
          Create Room
        </button>
      </section>

      <section className="flex w-full max-w-2xl flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 shadow-sm">
        <h2 className="text-xl font-semibold">Join Room</h2>
        <input
          className="rounded-lg border border-stone-300 bg-white px-3 py-2"
          value={roomId}
          onChange={(event) => setRoomId(event.target.value)}
          placeholder="Enter room id"
          aria-label="Room ID"
        />
        <button
          type="button"
          className="rounded-lg bg-teal-700 px-4 py-2 font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!roomId.trim()}
          onClick={() => router.push(`/room/${roomId.trim()}`)}
        >
          Join Room
        </button>
      </section>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <button
        type="button"
        className="rounded-lg border border-stone-300 bg-stone-50 px-4 py-2 text-sm text-stone-700 transition hover:bg-stone-100"
        onClick={() => void logout()}
      >
        Logout
      </button>
    </main>
  );
}
