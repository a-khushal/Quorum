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
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                copied
                  ? "bg-nc-success/20 text-nc-success"
                  : "bg-nc-primary/10 text-nc-primary hover:bg-nc-primary/20"
              }`}
            >
              {copied ? (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share
                </>
              )}
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
