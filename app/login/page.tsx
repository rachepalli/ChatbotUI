"use client";

import { Bot, Code2, Loader2, LogIn } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ThemeToggle from "@/components/ui/ThemeToggle";
import LanguageSwitcher from "@/components/ui/LanguageSwitcher";
import { useAppTranslation } from "@/components/ui/Language";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const t = useAppTranslation();

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

    setError(t("checkCredentials"));
  };

  return (
    <main className="auth-shell">
      <LanguageSwitcher />
      <ThemeToggle />
      <section className="auth-panel">
        <button type="button" onClick={() => router.push("/")} className="mb-8 flex items-center gap-2 font-semibold">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[color:var(--accent)] text-white">
            <Bot size={20} />
          </span>
          AIVA
        </button>

        <h1 className="text-3xl font-semibold tracking-tight">{t("welcomeBack")}</h1>
        <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
          {t("signInDescription")}
        </p>

        <div className="mt-7 space-y-3">
          <input
            type="email"
            placeholder={t("emailAddress")}
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder={t("password")}
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
            {t("forgotPassword")}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </div>
        )}

        <button type="button" onClick={handleLogin} disabled={loading} className="btn-primary mt-5 w-full">
          {loading ? <Loader2 size={17} className="animate-spin" /> : <LogIn size={17} />}
          {loading ? t("signingIn") : t("signIn")}
        </button>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-[color:var(--border)]" />
          <span className="text-xs font-medium text-[color:var(--muted)]">{t("or")}</span>
          <div className="h-px flex-1 bg-[color:var(--border)]" />
        </div>

        <div className="space-y-3">
          <button type="button" onClick={() => signIn("google", { callbackUrl: "/chat" })} className="btn-secondary w-full">
            <span className="font-semibold">G</span>
            {t("continueWithGoogle")}
          </button>
          <button type="button" onClick={() => signIn("github", { callbackUrl: "/chat" })} className="btn-secondary w-full">
            <Code2 size={17} />
            {t("continueWithGithub")}
          </button>
        </div>

        <p className="mt-7 text-center text-sm text-[color:var(--muted)]">
          {t("newHere")}{" "}
          <button type="button" onClick={() => router.push("/signup")} className="font-semibold text-[color:var(--accent)]">
            {t("createAccount")}
          </button>
        </p>
      </section>
    </main>
  );
}
