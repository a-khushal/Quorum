"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { useAuth } from "../../components/auth-provider";

export default function AuthPage() {
  const router = useRouter();
  const { state, login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (state === "authenticated") {
      router.replace("/");
    }
  }, [router, state]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      if (mode === "register") {
        await register(email, password);
      }

      await login(email, password);
      router.push("/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-nc-body p-6">
      <form
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-nc-border bg-nc-card p-6"
        onSubmit={onSubmit}
      >
        <div className="text-center">
          <h1 className="text-2xl font-bold text-nc-text">
            {mode === "login" ? "Welcome back" : "Create account"}
          </h1>
          <p className="mt-1 text-sm text-nc-text-muted">
            {mode === "login" ? "Sign in to continue" : "Get started with Quorum"}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm text-nc-text-secondary">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            className="rounded-lg border border-nc-border bg-nc-card-hover px-3 py-2 text-nc-text placeholder:text-nc-text-muted outline-none transition focus:border-nc-primary"
            placeholder="you@example.com"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm text-nc-text-secondary">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className="rounded-lg border border-nc-border bg-nc-card-hover px-3 py-2 text-nc-text placeholder:text-nc-text-muted outline-none transition focus:border-nc-primary"
            placeholder="Enter password"
          />
        </div>

        {error && <p className="text-sm text-nc-error">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-nc-primary px-4 py-2.5 font-medium text-white transition hover:bg-nc-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
        </button>

        <div className="text-center">
          <button
            type="button"
            className="text-sm text-nc-text-muted transition hover:text-nc-primary"
            onClick={() => setMode((prev) => (prev === "login" ? "register" : "login"))}
          >
            {mode === "login" ? "Need an account? Register" : "Already have an account? Sign in"}
          </button>
        </div>
      </form>
    </main>
  );
}
