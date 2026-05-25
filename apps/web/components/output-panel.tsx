"use client";

import { useState } from "react";

type ExecutionState = "idle" | "running" | "success" | "error";

type HistoryEntry = {
  id: string;
  status: string;
  at: string;
};

type OutputPanelProps = {
  output: string;
  executionState: ExecutionState;
  history: HistoryEntry[];
  stdin: string;
  onStdinChange: (value: string) => void;
};

export const OutputPanel = ({ output, executionState, history, stdin, onStdinChange }: OutputPanelProps) => {
  const [stdinOpen, setStdinOpen] = useState(false);

  return (
    <div className="flex h-full flex-col bg-nc-editor">
      {/* Status bar */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-nc-border px-3">
        <div className="flex items-center gap-2">
          {executionState === "running" && (
            <span className="flex items-center gap-1.5 text-xs text-nc-warning">
              <span className="h-2 w-2 animate-pulse rounded-full bg-nc-warning" />
              Running...
            </span>
          )}
          {executionState === "success" && (
            <span className="flex items-center gap-1.5 text-xs text-nc-success">
              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              Success
            </span>
          )}
          {executionState === "error" && (
            <span className="flex items-center gap-1.5 text-xs text-nc-error">
              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
              Error
            </span>
          )}
          {executionState === "idle" && (
            <span className="text-xs text-nc-text-secondary">Ready</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Stdin toggle */}
          <button
            type="button"
            onClick={() => setStdinOpen((prev) => !prev)}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition ${
              stdinOpen || stdin
                ? "bg-nc-primary/20 text-nc-primary"
                : "text-nc-text-muted hover:text-nc-text"
            }`}
            title="Toggle stdin input"
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            stdin
            {stdin && !stdinOpen && (
              <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-nc-primary" />
            )}
          </button>

          {/* History dots */}
          {history.length > 0 && (
            <div className="flex items-center gap-1.5">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className={`h-2 w-2 rounded-full ${
                    entry.status === "success" ? "bg-nc-success" : "bg-nc-error"
                  }`}
                  title={`${entry.status} at ${entry.at}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stdin input area */}
      {stdinOpen && (
        <div className="shrink-0 border-b border-nc-border">
          <textarea
            className="w-full resize-none bg-nc-body p-3 font-mono text-sm text-nc-text placeholder:text-nc-text-muted outline-none"
            rows={3}
            placeholder="Enter stdin input here..."
            value={stdin}
            onChange={(e) => onStdinChange(e.target.value)}
            spellCheck={false}
          />
        </div>
      )}

      {/* Output content */}
      <div className="flex-1 overflow-auto p-3">
        <pre className="whitespace-pre-wrap wrap-break-word font-mono text-sm leading-relaxed text-nc-text">
          {output}
        </pre>
      </div>
    </div>
  );
};
