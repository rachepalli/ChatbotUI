"use client";

import { Languages } from "lucide-react";
import { appLanguages, applyLanguage, useAppTranslation, useLanguage } from "@/components/ui/Language";
import type { AppLanguage } from "@/components/ui/Language";

type LanguageSwitcherProps = {
  className?: string;
};

export default function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  const language = useLanguage();
  const t = useAppTranslation();

  return (
    <label
      className={
        className ||
        "fixed right-16 top-4 z-[70] inline-flex h-10 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm text-[color:var(--muted)] shadow-md backdrop-blur transition hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]"
      }
      title={t("language")}
    >
      <Languages size={16} />
      <select
        value={language}
        onChange={(event) => applyLanguage(event.target.value as AppLanguage)}
        aria-label={t("language")}
        className="cursor-pointer bg-transparent text-sm font-medium outline-none"
      >
        {appLanguages.map((item) => (
          <option key={item.code} value={item.code}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}
