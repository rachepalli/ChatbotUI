"use client";

import { ArrowRight, Bot, MessageSquareText, ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import ThemeToggle from "@/components/ui/ThemeToggle";
import LanguageSwitcher from "@/components/ui/LanguageSwitcher";
import { useAppTranslation } from "@/components/ui/Language";

export default function Home() {
  const router = useRouter();
  const t = useAppTranslation();

  return (
    <main className="app-shell text-[color:var(--foreground)]">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="flex items-center gap-2 font-semibold"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[color:var(--accent)] text-white">
            <Bot size={20} />
          </span>
          RVK
        </button>

        <div className="flex items-center gap-2">
          <LanguageSwitcher className="inline-flex h-10 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm text-[color:var(--muted)] transition hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]" />
          <ThemeToggle className="icon-btn h-10 w-10 border border-[color:var(--border)] bg-[color:var(--surface)]" />
          <button type="button" onClick={() => router.push("/login")} className="btn-secondary px-4 hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/10 dark:hover:shadow-black/30">
            {t("signIn")}
          </button>
          <button type="button" onClick={() => router.push("/signup")} className="btn-primary px-4 hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/10 dark:hover:shadow-black/30">
            {t("start")}
            <ArrowRight size={16} />
          </button>
        </div>
      </header>

      <section className="mx-auto flex min-h-[calc(100vh-88px)] w-full max-w-6xl flex-col items-center justify-center px-5 pb-10 pt-8 text-center">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            {t("homeHeroTitle")}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-[color:var(--muted)] sm:text-lg">
            {t("homeHeroDescription")}
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => router.push("/signup")} className="btn-primary px-5 hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/10 dark:hover:shadow-black/30">
              {t("createAccount")}
              <ArrowRight size={17} />
            </button>
            <button type="button" onClick={() => router.push("/login")} className="btn-secondary px-5 hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/10 dark:hover:shadow-black/30">
              {t("signIn")}
            </button>
          </div>
        </div>

        <div className="mt-12 grid w-full max-w-4xl gap-3 text-left sm:grid-cols-3">
          <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 transition duration-200 hover:-translate-y-1 hover:border-[color:var(--accent)] hover:shadow-lg hover:shadow-black/10 dark:hover:shadow-black/30">
            <ShieldCheck size={18} className="mb-3 text-[color:var(--accent)]" />
            <h2 className="font-semibold">{t("homeFeatureSecureTitle")}</h2>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{t("homeFeatureSecureDescription")}</p>
          </div>
          <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 transition duration-200 hover:-translate-y-1 hover:border-[color:var(--accent)] hover:shadow-lg hover:shadow-black/10 dark:hover:shadow-black/30">
            <Sparkles size={18} className="mb-3 text-[color:var(--accent)]" />
            <h2 className="font-semibold">{t("homeFeatureModelTitle")}</h2>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{t("homeFeatureModelDescription")}</p>
          </div>
          <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 transition duration-200 hover:-translate-y-1 hover:border-[color:var(--accent)] hover:shadow-lg hover:shadow-black/10 dark:hover:shadow-black/30">
            <MessageSquareText size={18} className="mb-3 text-[color:var(--accent)]" />
            <h2 className="font-semibold">{t("homeFeatureSavedTitle")}</h2>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{t("homeFeatureSavedDescription")}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
