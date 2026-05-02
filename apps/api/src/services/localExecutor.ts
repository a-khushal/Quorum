import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import type { ExecutionResult } from "./judge0.js";
import type { SupportedLanguage } from "./judge0.js";

const runProcess = async (command: string, args: string[], timeoutMs: number) => {
  return await new Promise<{ stdout: string; stderr: string; timedOut: boolean }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", () => {
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut });
    });
  });
};

const runPython = async (sourceCode: string) => {
  const dir = await mkdtemp(join(tmpdir(), "quorum-exec-"));
  const filePath = join(dir, "script.py");
  await writeFile(filePath, sourceCode, "utf8");

  try {
    return await runProcess("python3", [filePath], 10_000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const runTypescript = async (sourceCode: string) => {
  const dir = await mkdtemp(join(tmpdir(), "quorum-exec-"));
  const filePath = join(dir, "script.ts");
  await writeFile(filePath, sourceCode, "utf8");

  try {
    return await runProcess("pnpm", ["exec", "tsx", filePath], 10_000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const toExecutionResult = (result: { stdout: string; stderr: string; timedOut: boolean }): ExecutionResult => {
  if (result.timedOut) {
    return {
      token: "local",
      status: { id: 5, description: "Time Limit Exceeded" },
      stdout: result.stdout || null,
      stderr: result.stderr || null,
      compile_output: null,
      message: "Execution timed out",
      time: null,
      memory: null,
    };
  }

  if (result.stderr) {
    return {
      token: "local",
      status: { id: 11, description: "Runtime Error" },
      stdout: result.stdout || null,
      stderr: result.stderr,
      compile_output: null,
      message: null,
      time: null,
      memory: null,
    };
  }

  return {
    token: "local",
    status: { id: 3, description: "Accepted" },
    stdout: result.stdout || null,
    stderr: result.stderr || null,
    compile_output: null,
    message: null,
    time: null,
    memory: null,
  };
};

export const executeLocally = async (sourceCode: string, language: SupportedLanguage): Promise<ExecutionResult> => {
  if (language === "PYTHON") {
    return toExecutionResult(await runPython(sourceCode));
  }

  if (language === "TYPESCRIPT") {
    return toExecutionResult(await runTypescript(sourceCode));
  }

  return {
    token: "local",
    status: { id: 6, description: "Compilation Error" },
    stdout: null,
    stderr: null,
    compile_output: `Local execution provider supports only TYPESCRIPT and PYTHON, got ${language}`,
    message: null,
    time: null,
    memory: null,
  };
};
