"use client";

import { ArrowLeft, Bot, Loader2, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleForgotPassword = async () => {
    setError("");
    setMessage("");

    if (!email) {
      setError("Enter your email address.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Could not send reset link.");
      } else {
        setMessage(data.message || "If an account exists, a reset link has been sent.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <button type="button" onClick={() => router.push("/")} className="mb-8 flex items-center gap-2 font-semibold">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[color:var(--accent)] text-white">
            <Bot size={20} />
          </span>
          RVK
        </button>

        <h1 className="text-3xl font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
          Enter your account email and we will send a reset link if the account exists.
        </p>

        <div className="mt-7">
          <input
            type="email"
            placeholder="Email address"
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleForgotPassword();
            }}
          />
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </div>
        )}
        {message && (
          <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
            {message}
          </div>
        )}

        <button type="button" onClick={handleForgotPassword} disabled={loading} className="btn-primary mt-5 w-full">
          {loading ? <Loader2 size={17} className="animate-spin" /> : <Mail size={17} />}
          {loading ? "Sending link" : "Send reset link"}
        </button>

        <button type="button" onClick={() => router.push("/login")} className="btn-ghost mt-4 w-full">
          <ArrowLeft size={16} />
          Back to sign in
        </button>
      </section>
    </main>
  );
}
