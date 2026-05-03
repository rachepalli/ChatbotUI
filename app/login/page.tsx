"use client";

import { Bot, Code2, Loader2, LogIn } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    setError("");
    setLoading(true);

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (!res?.error) {
      router.push("/chat");
      return;
    }

    setError("Check your email and password, then try again.");
  };

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <button type="button" onClick={() => router.push("/")} className="mb-8 flex items-center gap-2 font-semibold">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[color:var(--accent)] text-white">
            <Bot size={20} />
          </span>
          RVKBot
        </button>

        <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
          Sign in to continue your conversations.
        </p>

        <div className="mt-7 space-y-3">
          <input
            type="email"
            placeholder="Email address"
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            className="field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLogin();
            }}
          />
        </div>

        <div className="mt-3 flex justify-end">
          <button type="button" onClick={() => router.push("/forgot-password")} className="text-sm font-medium text-[color:var(--accent)]">
            Forgot password?
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </div>
        )}

        <button type="button" onClick={handleLogin} disabled={loading} className="btn-primary mt-5 w-full">
          {loading ? <Loader2 size={17} className="animate-spin" /> : <LogIn size={17} />}
          {loading ? "Signing in" : "Sign in"}
        </button>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-[color:var(--border)]" />
          <span className="text-xs font-medium text-[color:var(--muted)]">OR</span>
          <div className="h-px flex-1 bg-[color:var(--border)]" />
        </div>

        <div className="space-y-3">
          <button type="button" onClick={() => signIn("google", { callbackUrl: "/chat" })} className="btn-secondary w-full">
            <span className="font-semibold">G</span>
            Continue with Google
          </button>
          <button type="button" onClick={() => signIn("github", { callbackUrl: "/chat" })} className="btn-secondary w-full">
            <Code2 size={17} />
            Continue with GitHub
          </button>
        </div>

        <p className="mt-7 text-center text-sm text-[color:var(--muted)]">
          New here?{" "}
          <button type="button" onClick={() => router.push("/signup")} className="font-semibold text-[color:var(--accent)]">
            Create an account
          </button>
        </p>
      </section>
    </main>
  );
}
