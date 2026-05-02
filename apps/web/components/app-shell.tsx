"use client";

import Link from "next/link";

type AppShellProps = {
  roomId: string;
  connectionState: "connected" | "reconnecting" | "disconnected";
  userEmail: string;
  onLogout: () => Promise<void>;
  children: React.ReactNode;
};

export const AppShell = ({ roomId, connectionState, userEmail, onLogout, children }: AppShellProps) => {
  const statusTone =
    connectionState === "connected" ? "text-emerald-700" : connectionState === "reconnecting" ? "text-amber-700" : "text-rose-700";

  return (
    <div className="flex min-h-screen flex-col gap-4 p-4">
      <header className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Quorum
          </Link>
          <p className="text-sm text-stone-500">Room: {roomId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full border border-stone-200 px-3 py-1 text-xs font-medium uppercase tracking-wide ${statusTone}`}>
            {connectionState}
          </span>
          <span className="text-sm text-stone-600">{userEmail}</span>
          <button
            type="button"
            className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-teal-800"
            onClick={() => void onLogout()}
          >
            Logout
          </button>
        </div>
      </header>
      {children}
    </div>
  );
};
