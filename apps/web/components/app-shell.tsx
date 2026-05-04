"use client";

import Link from "next/link";
import { useState } from "react";

type AppShellProps = {
  roomId: string;
  connectionState: "connected" | "reconnecting" | "disconnected";
  userCount: number;
  userEmail: string;
  onLogout: () => Promise<void>;
  children: React.ReactNode;
};

export const AppShell = ({
  roomId,
  connectionState,
  userCount,
  userEmail,
  onLogout,
  children,
}: AppShellProps) => {
  const [copied, setCopied] = useState(false);

  const copyRoomLink = async () => {
    const url = `${window.location.origin}/room/${roomId}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const connectionDot =
    connectionState === "connected"
      ? "bg-nc-success"
      : connectionState === "reconnecting"
        ? "bg-nc-warning"
        : "bg-nc-error";

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-nc-border bg-nc-card px-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-base font-semibold text-nc-text hover:text-nc-primary">
            Quorum
          </Link>
          <div className="h-4 w-px bg-nc-border" />
          <div className="flex items-center gap-2">
            <span className="text-sm text-nc-text-secondary">
              Room: <span className="font-mono text-nc-text">{roomId.slice(0, 8)}</span>
            </span>
            <button
              type="button"
              onClick={() => void copyRoomLink()}
              className="rounded border border-nc-border px-2 py-0.5 text-xs text-nc-text-secondary transition hover:border-nc-primary hover:text-nc-primary"
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${connectionDot}`} />
            <span className="text-xs text-nc-text-muted capitalize">{connectionState}</span>
          </div>
          <div className="h-4 w-px bg-nc-border" />
          <span className="text-xs text-nc-text-muted">
            {userCount} {userCount === 1 ? "user" : "users"}
          </span>
          <div className="h-4 w-px bg-nc-border" />
          <span className="max-w-32 truncate text-sm text-nc-text-secondary">{userEmail}</span>
          <button
            type="button"
            className="rounded border border-nc-border bg-nc-card-hover px-2.5 py-1 text-xs font-medium text-nc-text-secondary transition hover:border-nc-text-muted hover:text-nc-text"
            onClick={() => void onLogout()}
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
};
