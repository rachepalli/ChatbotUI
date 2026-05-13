"use client";

import { Bot, Loader2, UserPlus } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ThemeToggle from "@/components/ui/ThemeToggle";
import LanguageSwitcher from "@/components/ui/LanguageSwitcher";
import { useAppTranslation } from "@/components/ui/Language";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const t = useAppTranslation();

  const handleSignup = async () => {
    setError("");

    if (!name || !email || !password || !confirmPassword) {
      setError(t("fillAllFields"));
      return;
    }

    if (password !== confirmPassword) {
      setError(t("passwordsDoNotMatch"));
      return;
    }

    if (password.length < 6) {
      setError(t("useSixPassword"));
      return;
    }

    setLoading(true);

    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      setLoading(false);
      setError(data.error || t("signupFailed"));
      return;
    }

    const loginRes = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);
    router.push(loginRes?.error ? "/login" : "/chat");
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
          RVK
        </button>

        <h1 className="text-3xl font-semibold tracking-tight">{t("createAccountTitle")}</h1>
        <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
          {t("signUpDescription")}
        </p>

        <div className="mt-7 space-y-3">
          <input type="text" placeholder={t("fullName")} className="field" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="email" placeholder={t("emailAddress")} className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" placeholder={t("password")} className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
          <input
            type="password"
            placeholder={t("confirmPassword")}
            className="field"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSignup();
            }}
          />
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </div>
        )}

        <button type="button" onClick={handleSignup} disabled={loading} className="btn-primary mt-5 w-full">
          {loading ? <Loader2 size={17} className="animate-spin" /> : <UserPlus size={17} />}
          {loading ? t("creatingAccount") : t("createAccount")}
        </button>

        <p className="mt-7 text-center text-sm text-[color:var(--muted)]">
          {t("alreadyHaveAccount")}{" "}
          <button type="button" onClick={() => router.push("/login")} className="font-semibold text-[color:var(--accent)]">
            {t("signIn")}
          </button>
        </p>
      </section>
    </main>
  );
}
