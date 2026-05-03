"use client";

import { Bot, Loader2, Sparkles } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Onboarding() {
  const router = useRouter();
  const { update } = useSession();
  const [loading, setLoading] = useState(false);

  const completeOnboarding = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/user/onboard", { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      await update();
      router.replace("/chat");
    } catch {
      alert("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-panel text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-[color:var(--accent)] text-white">
          <Bot size={24} />
        </div>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">Your workspace is ready</h1>
        <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">
          Start a new chat, pick a model, and keep useful conversations organized in the sidebar.
        </p>
        <button type="button" onClick={completeOnboarding} disabled={loading} className="btn-primary mt-7 w-full">
          {loading ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}
          {loading ? "Preparing workspace" : "Continue to chat"}
        </button>
      </section>
    </main>
  );
}
