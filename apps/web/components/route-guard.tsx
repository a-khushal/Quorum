"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "./auth-provider";

export const RouteGuard = ({ children }: { children: React.ReactNode }) => {
  const router = useRouter();
  const { state } = useAuth();

  useEffect(() => {
    if (state === "unauthenticated") {
      router.replace("/auth");
    }
  }, [router, state]);

  if (state === "loading") {
    return <div className="grid min-h-screen place-items-center text-stone-600">Checking session...</div>;
  }

  if (state === "unauthenticated") {
    return null;
  }

  return <>{children}</>;
};
