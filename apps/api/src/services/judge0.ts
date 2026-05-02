import { env } from "../config/env.js";

type Judge0SubmissionResponse = {
  token: string;
};

export type ExecutionStatus = {
  id: number;
  description: string;
};

export type ExecutionResult = {
  token: string;
  status: ExecutionStatus;
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  time: string | null;
  memory: number | null;
};

const terminalStatusIds = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

const languageToJudge0Id = {
  TYPESCRIPT: 74,
  PYTHON: 71,
  JAVA: 62,
  GO: 60,
  CPP: 54,
  C: 50,
} as const;

export type SupportedLanguage = keyof typeof languageToJudge0Id;

export const getJudge0LanguageId = (language: SupportedLanguage) => {
  return languageToJudge0Id[language];
};

const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const submitToJudge0 = async (sourceCode: string, languageId: number, requestId?: string) => {
  const response = await fetch(`${env.judge0Url}/submissions?base64_encoded=false&wait=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_code: sourceCode,
      language_id: languageId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Judge0 submit failed with status ${response.status}`);
  }

  const submission = (await response.json()) as Judge0SubmissionResponse;
  console.log(
    JSON.stringify({
      event: "execute.judge0.submitted",
      requestId: requestId ?? "",
      token: submission.token,
      languageId,
    }),
  );

  return submission;
};

const getSubmission = async (token: string) => {
  const response = await fetch(`${env.judge0Url}/submissions/${token}?base64_encoded=false`);

  if (!response.ok) {
    throw new Error(`Judge0 poll failed with status ${response.status}`);
  }

  return (await response.json()) as ExecutionResult;
};

export const executeWithJudge0 = async (sourceCode: string, language: SupportedLanguage, requestId?: string) => {
  const languageId = getJudge0LanguageId(language);
  const { token } = await submitToJudge0(sourceCode, languageId, requestId);

  const timeoutMs = 25_000;
  const intervalMs = 700;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const result = await getSubmission(token);

    if (terminalStatusIds.has(result.status.id)) {
      console.log(
        JSON.stringify({
          event: "execute.judge0.completed",
          requestId: requestId ?? "",
          token,
          statusId: result.status.id,
          status: result.status.description,
        }),
      );
      return result;
    }

    await sleep(intervalMs);
  }

  throw new Error("Judge0 execution timed out");
};
