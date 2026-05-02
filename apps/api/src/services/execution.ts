import { env } from "../config/env.js";
import { executeWithJudge0 } from "./judge0.js";
import type { ExecutionResult, SupportedLanguage } from "./judge0.js";
import { executeLocally } from "./localExecutor.js";

const provider = env.executionProvider;

export const executeCode = async (sourceCode: string, language: SupportedLanguage): Promise<ExecutionResult> => {
  if (provider === "local") {
    return await executeLocally(sourceCode, language);
  }

  return await executeWithJudge0(sourceCode, language);
};
