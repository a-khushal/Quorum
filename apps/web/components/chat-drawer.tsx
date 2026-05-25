"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ChatMessage = {
  id: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: number;
};

type ChatDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  currentUserId: string;
  onSendMessage: (message: string) => void;
};

export const ChatDrawer = ({
  isOpen,
  onClose,
  messages,
  currentUserId,
  onSendMessage,
}: ChatDrawerProps) => {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      inputRef.current?.focus();
    }
  }, [messages, isOpen, scrollToBottom]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInput("");
    inputRef.current?.focus();
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  if (!isOpen) return null;

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-nc-border bg-nc-body">
      {/* Header - matches video panel header h-10 */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-nc-border px-3">
        <span className="text-sm font-medium text-nc-text">In-call messages</span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-nc-text-muted transition hover:bg-nc-card-hover hover:text-nc-text"
          title="Close chat"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <svg className="mb-2 h-10 w-10 text-nc-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-sm text-nc-text-muted">No messages yet</p>
            <p className="mt-1 text-xs text-nc-text-muted/70">Messages are visible to everyone in the call</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOwnMessage = msg.userId === currentUserId;
            return (
              <div key={msg.id} className="flex flex-col">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-nc-text">
                    {isOwnMessage ? "You" : msg.userName}
                  </span>
                  <span className="text-xs text-nc-text-muted">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
                <div className="text-sm text-nc-text break-words">
                  {msg.message}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input - matches video controls height exactly */}
      <form onSubmit={handleSubmit} className="flex shrink-0 items-center border-t border-nc-border px-3 py-2">
        <div className="flex h-9 flex-1 items-center gap-2 rounded-full border border-nc-border bg-nc-card px-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send a message"
            maxLength={500}
            className="flex-1 bg-transparent text-sm text-nc-text placeholder-nc-text-muted focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-nc-primary transition hover:bg-nc-card-hover disabled:cursor-not-allowed disabled:text-nc-text-muted"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
};
