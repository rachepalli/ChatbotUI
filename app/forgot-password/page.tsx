"use client";

import { ArrowLeft, Bot, Loader2, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import LanguageSwitcher from "@/components/ui/LanguageSwitcher";
import { useAppTranslation } from "@/components/ui/Language";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [devResetUrl, setDevResetUrl] = useState("");
  const [error, setError] = useState("");
  const t = useAppTranslation();

  const handleForgotPassword = async () => {
    setError("");
    setMessage("");
    setDevResetUrl("");

    if (!email) {
      setError(t("enterEmailAddress"));
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
        setError(data.error || data.message || t("couldNotSendResetLink"));
      } else {
        setMessage(data.message || t("ifAccountExistsResetSent"));
        if (typeof data.devResetUrl === "string") {
          setDevResetUrl(data.devResetUrl);
        }
        if (typeof data.emailError === "string" && process.env.NODE_ENV === "development") {
          console.warn("Password reset email failed:", data.emailError);
        }
      }
    } catch {
      setError(t("somethingWentWrong"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell">
      <LanguageSwitcher />
      <section className="auth-panel">
        <button type="button" onClick={() => router.push("/")} className="mb-8 flex items-center gap-2 font-semibold">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[color:var(--accent)] text-white">
            <Bot size={20} />
          </span>
          AIVA
        </button>

        <h1 className="text-3xl font-semibold tracking-tight">{t("resetPasswordTitle")}</h1>
        <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
          {t("forgotPasswordDescription")}
        </p>

        <div className="mt-7">
          <input
            type="email"
            placeholder={t("emailAddress")}
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
        {devResetUrl && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
            <p className="font-medium">{t("devResetLinkTitle")}</p>
            <p className="mt-1 text-xs opacity-90">{t("devResetLinkDescription")}</p>
            <a
              href={devResetUrl}
              className="mt-2 inline-block break-all font-medium text-[color:var(--accent)] underline"
            >
              {devResetUrl}
            </a>
          </div>
        )}

        <button type="button" onClick={handleForgotPassword} disabled={loading} className="btn-primary mt-5 w-full">
          {loading ? <Loader2 size={17} className="animate-spin" /> : <Mail size={17} />}
          {loading ? t("sendingLink") : t("sendResetLink")}
        </button>

        <button type="button" onClick={() => router.push("/login")} className="btn-ghost mt-4 w-full">
          <ArrowLeft size={16} />
          {t("backToSignIn")}
        </button>
      </section>
    </main>
  );
}
