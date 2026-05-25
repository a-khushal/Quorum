"use client";

import Editor, { type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useRef, useEffect } from "react";

type CodeEditorProps = {
  language: string;
  value?: string;
  onChange?: (next: string) => void;
  onEditorMount?: (instance: editor.IStandaloneCodeEditor) => void;
  onRun?: () => void;
  readOnly?: boolean;
};

const languageMap: Record<string, string> = {
  TYPESCRIPT: "typescript",
  PYTHON: "python",
  JAVA: "java",
  GO: "go",
  CPP: "cpp",
  C: "c",
};

export const CodeEditor = ({ language, value, onChange, onEditorMount, onRun, readOnly = false }: CodeEditorProps) => {
  const onRunRef = useRef(onRun);

  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  const handleMount = (instance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    instance.addAction({
      id: "run-code",
      label: "Run Code",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => {
        onRunRef.current?.();
      },
    });
    onEditorMount?.(instance);
  };

  return (
    <Editor
      height="100%"
      language={languageMap[language] ?? "plaintext"}
      theme="vs-dark"
      value={value}
      onChange={(next) => onChange?.(next ?? "")}
      onMount={handleMount}
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
        readOnly,
      }}
    />
  );
};
