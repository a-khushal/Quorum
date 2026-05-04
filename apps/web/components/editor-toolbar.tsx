"use client";

import { useState } from "react";

type RoomLanguage = "TYPESCRIPT" | "PYTHON" | "JAVA" | "GO" | "CPP" | "C";

type EditorToolbarProps = {
  language: RoomLanguage;
  onLanguageChange: (language: RoomLanguage) => void;
  onRun: () => void;
  onEndRoom: () => void;
  onToggleVideo: () => void;
  canExecute: boolean;
  canEndRoom: boolean;
  isRunning: boolean;
  isRoomEnded: boolean;
  isVideoVisible: boolean;
  charCount: number;
  maxChars: number;
};

const languages: RoomLanguage[] = ["TYPESCRIPT", "PYTHON", "JAVA", "GO", "CPP", "C"];

const languageLabels: Record<RoomLanguage, string> = {
  TYPESCRIPT: "TypeScript",
  PYTHON: "Python",
  JAVA: "Java",
  GO: "Go",
  CPP: "C++",
  C: "C",
};

export const EditorToolbar = ({
  language,
  onLanguageChange,
  onRun,
  onEndRoom,
  onToggleVideo,
  canExecute,
  canEndRoom,
  isRunning,
  isRoomEnded,
  isVideoVisible,
  charCount,
  maxChars,
}: EditorToolbarProps) => {
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  const handleEndRoom = () => {
    setShowEndConfirm(false);
    onEndRoom();
  };

  return (
    <>
      {showEndConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-lg border border-nc-border bg-nc-card p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-nc-text">End Room?</h3>
            <p className="mt-2 text-sm text-nc-text-secondary">
              This will end the session for all participants. This action cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                className="rounded-md border border-nc-border bg-nc-card-hover px-4 py-2 text-sm font-medium text-nc-text transition hover:bg-nc-border"
                onClick={() => setShowEndConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-nc-error px-4 py-2 text-sm font-medium text-white transition hover:bg-nc-error/90"
                onClick={handleEndRoom}
              >
                End Room
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex h-11 items-center justify-between border-b border-nc-border bg-nc-card px-3">
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded border border-nc-border bg-nc-card-hover px-2 text-sm text-nc-text outline-none transition hover:border-nc-text-muted focus:border-nc-primary"
            value={language}
            onChange={(e) => onLanguageChange(e.target.value as RoomLanguage)}
          >
            {languages.map((lang) => (
              <option key={lang} value={lang} className="bg-nc-card">
                {languageLabels[lang]}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="flex h-8 items-center gap-1.5 rounded bg-nc-success px-3 text-sm font-medium text-nc-body transition hover:bg-nc-success-hover disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canExecute || isRunning}
            onClick={onRun}
          >
            {isRunning ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-nc-body border-t-transparent" />
                Running
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Run
              </>
            )}
          </button>

          {canEndRoom && (
            <button
              type="button"
              className="flex h-8 items-center gap-1.5 rounded border border-nc-border bg-nc-card-hover px-3 text-sm font-medium text-nc-text-secondary transition hover:border-nc-error hover:text-nc-error disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isRoomEnded}
              onClick={() => setShowEndConfirm(true)}
            >
              End Room
            </button>
          )}

          {isRoomEnded && (
            <span className="text-xs text-nc-text-muted">Room has ended</span>
          )}
        </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-nc-text-muted">
          {charCount.toLocaleString()}/{maxChars.toLocaleString()}
        </span>
        
        {/* Video toggle button */}
        <button
          type="button"
          onClick={onToggleVideo}
          className={`flex h-8 w-8 items-center justify-center rounded transition ${
            isVideoVisible
              ? "bg-nc-primary/20 text-nc-primary"
              : "bg-nc-card-hover text-nc-text-muted hover:text-nc-text"
          }`}
          title={isVideoVisible ? "Hide video (Ctrl+Shift+V)" : "Show video (Ctrl+Shift+V)"}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        </button>
        </div>
      </div>
    </>
  );
};
