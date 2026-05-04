"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ChatMessage = {
  id: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: number;
};

type ChatPanelProps = {
  messages: ChatMessage[];
  currentUserId: string;
  onSendMessage: (message: string) => void;
};

export const ChatPanel = ({ messages, currentUserId, onSendMessage }: ChatPanelProps) => {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

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

  return (
    <div className="flex h-full flex-col bg-nc-editor">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-nc-text-secondary">No messages yet</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOwnMessage = msg.userId === currentUserId;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isOwnMessage ? "items-end" : "items-start"}`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-medium text-nc-text-secondary">
                    {isOwnMessage ? "You" : msg.userName}
                  </span>
                  <span className="text-xs text-nc-text-secondary/60">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-1.5 text-sm break-words ${
                    isOwnMessage
                      ? "bg-nc-primary text-white"
                      : "bg-nc-card text-nc-text border border-nc-border"
                  }`}
                >
                  {msg.message}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-nc-border p-3">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            maxLength={500}
            className="flex-1 rounded border border-nc-border bg-nc-card px-3 py-2 text-sm text-nc-text placeholder-nc-text-secondary focus:border-nc-primary focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded bg-nc-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-nc-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
};
