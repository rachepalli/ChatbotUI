"use client";

import { Bot, User } from "lucide-react";

type Props = {
  content: string;
  role: "user" | "assistant";
};

export default function Message({ content, role }: Props) {
  const isUser = role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent)] text-white">
          <Bot size={17} />
        </div>
      )}
      <div
        className={`max-w-[82%] rounded-lg px-4 py-3 text-sm leading-6 ${
          isUser
            ? "bg-[color:var(--accent)] text-white"
            : "border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--foreground)]"
        }`}
      >
        {content}
      </div>
      {isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--surface-muted)] text-[color:var(--muted)]">
          <User size={17} />
        </div>
      )}
    </div>
  );
}
