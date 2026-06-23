"use client";

import { Bot, CheckCircle2, Loader2, LockKeyhole } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LanguageSwitcher from "@/components/ui/LanguageSwitcher";
import { useAppTranslation } from "@/components/ui/Language";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const t = useAppTranslation();

  const handleResetPassword = async () => {
    setError("");
    setMessage("");

    if (!token) {
      setError(t("missingResetToken"));
      return;
    }

    if (!password || password.length < 6) {
      setError(t("passwordMinLengthNew"));
      return;
    }

    if (password !== confirmPassword) {
      setError(t("passwordsDoNotMatch"));
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || t("unableToResetPassword"));
      } else {
        setMessage(t("passwordResetSuccessful"));
        setTimeout(() => router.push("/login"), 1200);
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

        <h1 className="text-3xl font-semibold tracking-tight">{t("chooseNewPassword")}</h1>
        <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
          {t("makePasswordDescription")}
        </p>

        <div className="mt-7 space-y-3">
          <input
            type="password"
            placeholder={t("newPassword")}
            className="field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
          <input
            type="password"
            placeholder={t("confirmNewPassword")}
            className="field"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleResetPassword();
            }}
          />
        </div>

        {password && (
          <p className={`mt-2 text-sm ${password.length >= 6 ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300"}`}>
            {password.length >= 6 ? t("passwordLengthGood") : t("passwordMinLength")}
          </p>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </div>
        )}
        {message && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
            <CheckCircle2 size={16} />
            {message}
          </div>
        )}

        <button type="button" onClick={handleResetPassword} disabled={loading} className="btn-primary mt-5 w-full">
          {loading ? <Loader2 size={17} className="animate-spin" /> : <LockKeyhole size={17} />}
          {loading ? t("resettingPassword") : t("resetPassword")}
        </button>
      </section>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main className="auth-shell" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
