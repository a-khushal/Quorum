"use client";

import Editor from "@monaco-editor/react";

type CodeEditorProps = {
  language: string;
  value: string;
  onChange: (next: string) => void;
};

const languageMap: Record<string, string> = {
  TYPESCRIPT: "typescript",
  PYTHON: "python",
  JAVA: "java",
  GO: "go",
  CPP: "cpp",
  C: "c",
};

export const CodeEditor = ({ language, value, onChange }: CodeEditorProps) => {
  return (
    <div className="overflow-hidden rounded-xl border border-stone-300 bg-white">
      <Editor
        height="420px"
        language={languageMap[language] ?? "plaintext"}
        value={value}
        onChange={(next) => onChange(next ?? "")}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          wordWrap: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
        }}
      />
    </div>
  );
};
