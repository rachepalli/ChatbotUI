"use client";

import { Bot, Loader2, Sparkles } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import LanguageSwitcher from "@/components/ui/LanguageSwitcher";
import { useAppTranslation } from "@/components/ui/Language";

export default function Onboarding() {
  const router = useRouter();
  const { update } = useSession();
  const [loading, setLoading] = useState(false);
  const t = useAppTranslation();

  const completeOnboarding = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/user/onboard", { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      await update();
      router.replace("/chat");
    } catch {
      alert(t("somethingWentWrongShort"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell">
      <LanguageSwitcher />
      <section className="auth-panel text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-[color:var(--accent)] text-white">
          <Bot size={24} />
        </div>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">{t("onboardingTitle")}</h1>
        <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">
          {t("onboardingDescription")}
        </p>
        <button type="button" onClick={completeOnboarding} disabled={loading} className="btn-primary mt-7 w-full">
          {loading ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}
          {loading ? t("preparingWorkspace") : t("continueToChat")}
        </button>
      </section>
    </main>
  );
}
