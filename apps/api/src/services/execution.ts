import { env } from "../config/env.js";
import { executeWithJudge0 } from "./judge0.js";
import type { ExecutionResult, SupportedLanguage } from "./judge0.js";
import { executeLocally } from "./localExecutor.js";

const getProvider = () => {
  const provider = env.executionProvider;
  if (provider !== "local" && provider !== "judge0") {
    throw new Error(`Unsupported execution provider: ${provider}`);
  }

  if (provider === "local" && env.nodeEnv === "production") {
    throw new Error("Local execution provider is disabled in production");
  }

  return provider;
};

export const executeCode = async (
  sourceCode: string,
  language: SupportedLanguage,
  requestId?: string,
): Promise<ExecutionResult> => {
  const provider = getProvider();

  if (provider === "local") {
    return await executeLocally(sourceCode, language);
  }

  return await executeWithJudge0(sourceCode, language, requestId);
};

export const getExecutionProvider = () => getProvider();
