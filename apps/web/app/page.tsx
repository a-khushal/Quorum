"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAuth } from "../components/auth-provider";

type RoomLanguage = "TYPESCRIPT" | "PYTHON" | "JAVA" | "GO" | "CPP" | "C";

const languages: RoomLanguage[] = ["TYPESCRIPT", "PYTHON", "JAVA", "GO", "CPP", "C"];

const languageLabels: Record<RoomLanguage, string> = {
  TYPESCRIPT: "TypeScript",
  PYTHON: "Python",
  JAVA: "Java",
  GO: "Go",
  CPP: "C++",
  C: "C",
};

export default function Home() {
  const router = useRouter();
  const { state, user, logout, authRequest } = useAuth();
  const [roomId, setRoomId] = useState("");
  const [language, setLanguage] = useState<RoomLanguage>("TYPESCRIPT");
  const [error, setError] = useState("");

  const createRoom = async () => {
    setError("");
    try {
      const response = await authRequest<{ room: { id: string } }>("/rooms", {
        method: "POST",
        body: { language },
      });
      router.push(`/room/${response.room.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create room");
    }
  };

  if (state === "loading") {
    return (
      <main className="grid min-h-screen place-items-center bg-nc-body text-nc-text-secondary">
        Loading...
      </main>
    );
  }

  if (state === "unauthenticated") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-nc-body p-6 text-center">
        <div>
          <h1 className="text-5xl font-bold tracking-tight text-nc-text">Quorum</h1>
          <p className="mt-3 max-w-xl text-nc-text-secondary">
            Collaborative coding interviews with shared execution and real-time video.
          </p>
        </div>
        <Link
          href="/auth"
          className="rounded-lg bg-nc-primary px-6 py-2.5 font-medium text-white transition hover:bg-nc-primary-hover"
        >
          Get Started
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-nc-body p-6">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-nc-text">Quorum</h1>
        <p className="mt-2 text-sm text-nc-text-muted">Signed in as {user?.email}</p>
      </div>

      <div className="flex w-full max-w-lg flex-col gap-4">
        {/* Create Room */}
        <section className="rounded-xl border border-nc-border bg-nc-card p-5">
          <h2 className="mb-4 text-lg font-semibold text-nc-text">Create Room</h2>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <label htmlFor="language" className="text-sm text-nc-text-secondary">
                Language
              </label>
              <select
                id="language"
                className="flex-1 rounded-lg border border-nc-border bg-nc-card-hover px-3 py-2 text-nc-text outline-none transition focus:border-nc-primary"
                value={language}
                onChange={(event) => setLanguage(event.target.value as RoomLanguage)}
              >
                {languages.map((lang) => (
                  <option key={lang} value={lang} className="bg-nc-card">
                    {languageLabels[lang]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="rounded-lg bg-nc-success px-4 py-2.5 font-medium text-nc-body transition hover:bg-nc-success-hover"
              onClick={() => void createRoom()}
            >
              Create Room
            </button>
          </div>
        </section>

        {/* Join Room */}
        <section className="rounded-xl border border-nc-border bg-nc-card p-5">
          <h2 className="mb-4 text-lg font-semibold text-nc-text">Join Room</h2>
          <div className="flex flex-col gap-3">
            <input
              className="rounded-lg border border-nc-border bg-nc-card-hover px-3 py-2 text-nc-text placeholder:text-nc-text-muted outline-none transition focus:border-nc-primary"
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
              placeholder="Enter room ID"
              aria-label="Room ID"
            />
            <button
              type="button"
              className="rounded-lg bg-nc-primary px-4 py-2.5 font-medium text-white transition hover:bg-nc-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!roomId.trim()}
              onClick={() => router.push(`/room/${roomId.trim()}`)}
            >
              Join Room
            </button>
          </div>
        </section>
      </div>

      {error && <p className="text-sm text-nc-error">{error}</p>}

      <button
        type="button"
        className="rounded-lg border border-nc-border bg-nc-card px-4 py-2 text-sm text-nc-text-secondary transition hover:bg-nc-card-hover hover:text-nc-text"
        onClick={() => void logout()}
      >
        Logout
      </button>
    </main>
  );
}
