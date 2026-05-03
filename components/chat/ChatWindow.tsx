"use client";

import { Bot, Check, Copy, Paperclip, Send, Sparkles, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

export default function ChatWindow({
  activeChatId,
  setActiveChatId,
  onThreadsChanged,
}: any) {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [sending, setSending] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      return;
    }

    const optimisticChatId = sessionStorage.getItem("rvkbot:optimisticChatId");
    if (optimisticChatId === activeChatId) {
      return;
    }

    const loadMessages = async () => {
      const res = await fetch(`/api/message?chatId=${activeChatId}`);
      const data = await res.json();
      setMessages(data.messages || []);
    };

    loadMessages();
  }, [activeChatId]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [input]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleCopy = async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 1500);
  };

  const playReplySound = () => {
    const audio = new Audio("/notify.mp3");
    audio.volume = 0.7;
    audio.play().catch(() => {});
  };

  const modelLabel = (value: string) => {
    if (value === "gemini-2.5-flash") return "Gemini 2.5 Flash";
    if (value === "gemini-2.5-flash-lite") return "Gemini 2.5 Flash Lite";
    if (value === "llama-8b") return "LLaMA 8B";
    if (value === "llama-70b") return "LLaMA 70B";
    if (value === "ollama:llama3.2") return "Ollama Llama 3.2";
    if (value === "ollama:llama3.3:70b") return "Ollama LLaMA 70B";
    return value;
  };

  const formatReply = (data: any) => {
    const reply = data.reply || data.error || "No response from AI";
    if (!data.fallbackFrom) return reply;

    const reason = data.fallbackError?.message
      ? ` ${data.fallbackError.message}`
      : "";

    return `Note: ${modelLabel(data.fallbackFrom)} was unavailable.${reason} Answered with ${modelLabel(data.model)} instead.\n\n${reply}`;
  };

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    setInput("");
    setSending(true);

    const finalChatId = activeChatId || crypto.randomUUID();
    if (!activeChatId) {
      sessionStorage.setItem("rvkbot:optimisticChatId", finalChatId);
      setActiveChatId?.(finalChatId);
    }

    setMessages((prev) => [
      ...prev,
      { role: "user", content: trimmed },
      { role: "assistant", content: "Thinking..." },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, chatId: finalChatId, model }),
      });

      const data = await res.json();
      if (data.model && data.model !== model && !data.fallbackFrom) setModel(data.model);
      if (!res.ok) throw new Error(data.error || `Chat request failed with ${res.status}`);

      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: formatReply(data),
        };
        return updated;
      });
      playReplySound();

      onThreadsChanged?.();
      sessionStorage.removeItem("rvkbot:optimisticChatId");
    } catch (error) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: error instanceof Error ? error.message : "Failed to connect to AI API",
        };
        return updated;
      });
    } finally {
      setSending(false);
      sessionStorage.removeItem("rvkbot:optimisticChatId");
    }
  };

  return (
    <section className="flex h-screen min-w-0 flex-1 flex-col bg-[color:var(--background)]">
      <header className="flex h-16 items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--surface)] px-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">Chat workspace</h1>
          <p className="truncate text-xs text-[color:var(--muted)]">
            {activeChatId ? "History is saved automatically" : "Start a new conversation"}
          </p>
        </div>

        <label className="flex items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm">
          <Sparkles size={16} className="text-[color:var(--accent)]" />
          <select value={model} onChange={(e) => setModel(e.target.value)} className="bg-transparent text-sm outline-none">
            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
            <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
            <option value="llama-8b">LLaMA 8B</option>
            <option value="llama-70b">LLaMA 70B</option>
            <option value="ollama:llama3.2">Ollama Llama 3.2</option>
            <option value="ollama:llama3.3:70b">Ollama LLaMA 70B</option>
          </select>
        </label>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          {messages.length === 0 && (
            <div className="mt-20 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-6 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-[color:var(--surface-muted)] text-[color:var(--accent)]">
                <Bot size={22} />
              </div>
              <h2 className="mt-4 text-xl font-semibold">What are we working on?</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[color:var(--muted)]">
                Ask a question, compare models, summarize notes, or continue from a saved thread in the sidebar.
              </p>
            </div>
          )}

          {messages.map((msg, index) => {
            const isUser = msg.role === "user";
            return (
              <div key={`${msg._id || index}`} className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
                {!isUser && (
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent)] text-white">
                    <Bot size={17} />
                  </div>
                )}

                <div className={`group min-w-0 max-w-[82%] ${isUser ? "items-end" : "items-start"}`}>
                  <div
                    className={`rounded-lg px-4 py-3 text-sm leading-6 shadow-sm ${
                      isUser
                        ? "bg-[color:var(--accent)] text-white"
                        : "border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--foreground)]"
                    }`}
                  >
                    <div className="message-markdown">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopy(msg.content, index)}
                    className="mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[color:var(--muted)] opacity-0 transition hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)] group-hover:opacity-100"
                  >
                    {copiedIndex === index ? <Check size={13} /> : <Copy size={13} />}
                    {copiedIndex === index ? "Copied" : "Copy"}
                  </button>
                </div>

                {isUser && (
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--surface-muted)] text-[color:var(--muted)]">
                    <User size={17} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-[color:var(--border)] bg-[color:var(--surface)] p-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--background)] p-2">
          <button type="button" className="icon-btn shrink-0" title="Attach file">
            <Paperclip size={18} />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Message RVKBot"
            rows={1}
            className="max-h-44 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-[color:var(--muted)]"
          />
          <button type="button" onClick={sendMessage} disabled={!input.trim() || sending} className="btn-primary h-10 min-h-10 w-10 px-0" title="Send message">
            <Send size={17} />
          </button>
        </div>
      </div>
    </section>
  );
}
