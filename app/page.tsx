"use client";

import { ArrowRight, Bot, CheckCircle2, MessageSquareText, ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

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
          RVKBot
        </button>

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => router.push("/login")} className="btn-secondary px-4">
            Sign in
          </button>
          <button type="button" onClick={() => router.push("/signup")} className="btn-primary px-4">
            Start
            <ArrowRight size={16} />
          </button>
        </div>
      </header>

      <section className="mx-auto flex min-h-[calc(100vh-88px)] w-full max-w-6xl flex-col items-center justify-center px-5 pb-10 pt-8 text-center">
        <div className="max-w-3xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--muted)]">
            <CheckCircle2 size={16} className="text-[color:var(--accent)]" />
            Microservice-backed AI chat
          </div>

          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            A cleaner workspace for focused AI conversations.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-[color:var(--muted)] sm:text-lg">
            Start chats quickly, switch between Gemini and LLaMA models, and keep your conversation history organized in one responsive interface.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => router.push("/signup")} className="btn-primary px-5">
              Create account
              <ArrowRight size={17} />
            </button>
            <button type="button" onClick={() => router.push("/login")} className="btn-secondary px-5">
              Sign in
            </button>
          </div>
        </div>

        <div className="mt-12 grid w-full max-w-4xl gap-3 text-left sm:grid-cols-3">
          <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
            <ShieldCheck size={18} className="mb-3 text-[color:var(--accent)]" />
            <h2 className="font-semibold">Secure sessions</h2>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">Your chats stay tied to your account.</p>
          </div>
          <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
            <Sparkles size={18} className="mb-3 text-[color:var(--accent)]" />
            <h2 className="font-semibold">Model choice</h2>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">Use Gemini or LLaMA from one clean composer.</p>
          </div>
          <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
            <MessageSquareText size={18} className="mb-3 text-[color:var(--accent)]" />
            <h2 className="font-semibold">Saved threads</h2>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">Find, rename, archive, and revisit conversations.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
