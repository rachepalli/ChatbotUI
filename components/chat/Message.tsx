"use client";

import { Bot, User } from "lucide-react";
import ReactMarkdown from "react-markdown";

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
        {isUser ? (
          content
        ) : (
          <ReactMarkdown
            components={{
              h1: ({ children }) => <h1 className="mb-2 text-base font-semibold leading-6">{children}</h1>,
              h2: ({ children }) => <h2 className="mb-2 mt-3 text-sm font-semibold leading-6">{children}</h2>,
              h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-semibold leading-6">{children}</h3>,
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
              ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
              li: ({ children }) => <li className="pl-1">{children}</li>,
              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
              code: ({ children }) => (
                <code className="rounded bg-[color:var(--surface-muted)] px-1 py-0.5 text-[0.85em]">
                  {children}
                </code>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        )}
      </div>
      {isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--surface-muted)] text-[color:var(--muted)]">
          <User size={17} />
        </div>
      )}
    </div>
  );
}
