"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

export function applyTheme(nextTheme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", nextTheme === "dark");
  localStorage.setItem("theme", nextTheme);
  window.dispatchEvent(new Event("rvk:theme-change"));
}

export function toggleGlobalTheme() {
  const isDark = document.documentElement.classList.contains("dark");
  applyTheme(isDark ? "light" : "dark");
}

type ThemeToggleProps = {
  className?: string;
};

function getThemeSnapshot(): Theme {
  if (typeof window === "undefined") return "dark";
  const saved = localStorage.getItem("theme") as Theme | null;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return saved || (systemDark ? "dark" : "light");
}

function getServerThemeSnapshot(): Theme {
  return "dark";
}

function subscribeTheme(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener("rvk:theme-change", callback);
  window.addEventListener("storage", callback);
  media.addEventListener("change", callback);

  return () => {
    window.removeEventListener("rvk:theme-change", callback);
    window.removeEventListener("storage", callback);
    media.removeEventListener("change", callback);
  };
}

export function useTheme() {
  return useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
}

export default function ThemeToggle({ className }: ThemeToggleProps) {
  const theme = useTheme();

  const handleToggle = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label="Toggle dark mode"
      className={
        className ||
        "fixed right-4 top-4 z-[70] inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted)] shadow-md backdrop-blur transition hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]"
      }
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
