"use client";

import { Paperclip, Send } from "lucide-react";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { useAppTranslation } from "@/components/ui/Language";

type InputAreaProps = {
  onSend: (text: string) => void;
  disabled?: boolean;
};

export default function InputArea({ onSend, disabled }: InputAreaProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const t = useAppTranslation();

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [input]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || disabled) return;
    setInput("");
    onSend(text);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--background)] p-2">
      <button type="button" className="icon-btn shrink-0" title={t("attachFile")}>
        <Paperclip size={18} />
      </button>
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t("messagePlaceholder")}
        disabled={disabled}
        rows={1}
        className="max-h-44 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-[color:var(--muted)]"
      />
      <button type="button" onClick={handleSend} disabled={!input.trim() || disabled} className="btn-primary h-10 min-h-10 w-10 px-0" title={t("sendMessage")}>
        <Send size={17} />
      </button>
    </div>
  );
}
