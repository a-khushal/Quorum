"use client";

import Editor from "@monaco-editor/react";
import type { editor } from "monaco-editor";

type CodeEditorProps = {
  language: string;
  value: string;
  onChange: (next: string) => void;
  onEditorMount?: (instance: editor.IStandaloneCodeEditor) => void;
};

const languageMap: Record<string, string> = {
  TYPESCRIPT: "typescript",
  PYTHON: "python",
  JAVA: "java",
  GO: "go",
  CPP: "cpp",
  C: "c",
};

export const CodeEditor = ({ language, value, onChange, onEditorMount }: CodeEditorProps) => {
  return (
    <Editor
      height="100%"
      language={languageMap[language] ?? "plaintext"}
      theme="vs-dark"
      value={value}
      onChange={(next) => onChange(next ?? "")}
      onMount={(instance) => onEditorMount?.(instance)}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        fontFamily: "var(--font-geist-mono), monospace",
        wordWrap: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        padding: { top: 12, bottom: 12 },
        lineNumbersMinChars: 3,
        folding: true,
        renderLineHighlight: "line",
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
      }}
    />
  );
};
