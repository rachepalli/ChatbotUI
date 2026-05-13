"use client";

import {
  AlignLeft,
  BookOpen,
  Bot,
  Brain,
  Camera,
  ChartLine,
  Check,
  Copy,
  FileText,
  Image as ImageIcon,
  Languages,
  Lightbulb,
  Mic,
  MicOff,
  Paperclip,
  PenLine,
  Search,
  Send,
  Sparkles,
  Type,
  User,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { useAppTranslation } from "@/components/ui/Language";

type Attachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: "image" | "document";
  text?: string;
  dataUrl?: string;
};

type ChatMessage = {
  _id?: string;
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
};

type ChatWindowProps = {
  activeChatId?: string | null;
  setActiveChatId?: (chatId: string | null) => void;
  onThreadsChanged?: () => void;
};

type ChatResponse = {
  reply?: string;
  error?: string;
  model?: string;
  fallbackFrom?: string;
  fallbackError?: { message?: string };
};

type SpeechRecognitionConstructor = new () => SpeechRecognition;

type SpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEvent = {
  results: SpeechRecognitionResultList;
};

type SpeechRecognitionErrorEvent = {
  error: string;
};

type SpeechRecognitionResultList = {
  length: number;
  item: (index: number) => SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
};

type SpeechRecognitionResult = {
  length: number;
  isFinal: boolean;
  item: (index: number) => SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
};

type SpeechRecognitionAlternative = {
  transcript: string;
};

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
  webkitAudioContext?: typeof AudioContext;
};

const textLikeExtensions = [
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".tsv",
  ".log",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
];

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isDocx(file: File) {
  return (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx")
  );
}

function isTextLike(file: File) {
  const name = file.name.toLowerCase();
  return file.type.startsWith("text/") || textLikeExtensions.some((ext) => name.endsWith(ext));
}

function readAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read file"));
    reader.readAsText(file);
  });
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChatWindow({
  activeChatId,
  setActiveChatId,
  onThreadsChanged,
}: ChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [sending, setSending] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [chatScrolled, setChatScrolled] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const t = useAppTranslation();

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const photosInputRef = useRef<HTMLInputElement | null>(null);
  const documentsInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const voiceBaseTextRef = useRef("");

  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      return;
    }

    const optimisticChatId = sessionStorage.getItem("rvk:optimisticChatId");
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

  useEffect(() => {
    const speechWindow = window as SpeechWindow;
    setSpeechSupported(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));

    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

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

  const playVoiceTone = (type: "start" | "stop") => {
    try {
      const speechWindow = window as SpeechWindow;
      const AudioContextApi = window.AudioContext || speechWindow.webkitAudioContext;
      const audioContext = new AudioContextApi();
      const now = audioContext.currentTime;
      const notes = type === "start" ? [523.25, 659.25, 783.99] : [783.99, 659.25, 523.25];

      notes.forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const start = now + index * 0.055;
        const end = start + 0.12;

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.09, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);

        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(start);
        oscillator.stop(end);
      });

      setTimeout(() => audioContext.close().catch(() => {}), 360);
    } catch {
      // Audio feedback is optional.
    }
  };

  const addFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    setAttachmentError("");

    try {
      const nextAttachments = await Promise.all(
        files.map(async (file) => {
          if (file.size > 12 * 1024 * 1024) {
            throw new Error(`${file.name} ${t("attachmentTooLarge")}`);
          }

          const isImage = file.type.startsWith("image/");
          const attachment: Attachment = {
            id: crypto.randomUUID(),
            name: file.name || (isImage ? t("cameraPhoto") : t("document")),
            type: file.type || "application/octet-stream",
            size: file.size,
            kind: isImage ? "image" : "document",
          };

          if (isImage) {
            attachment.dataUrl = await readAsDataUrl(file);
          } else if (isPdf(file) || isDocx(file)) {
            attachment.dataUrl = await readAsDataUrl(file);
          } else if (isTextLike(file)) {
            attachment.text = (await readAsText(file)).slice(0, 24000);
          } else {
            attachment.text = "";
          }

          return attachment;
        })
      );

      setAttachments((current) => [...current, ...nextAttachments].slice(0, 8));
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : t("couldNotAttachFile"));
    }
  };

  const openFilePicker = (kind: "photos" | "documents" | "camera") => {
    setAttachMenuOpen(false);
    if (kind === "photos") photosInputRef.current?.click();
    if (kind === "documents") documentsInputRef.current?.click();
    if (kind === "camera") cameraInputRef.current?.click();
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };

  const handleChatScroll = () => {
    setChatScrolled(Boolean(scrollRef.current && scrollRef.current.scrollTop > 6));
  };

  const stopVoiceInput = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    playVoiceTone("stop");
  };

  const toggleVoiceInput = () => {
    setVoiceError("");

    if (listening) {
      stopVoiceInput();
      return;
    }

    const speechWindow = window as SpeechWindow;
    const SpeechRecognitionApi = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognitionApi) {
      setVoiceError(t("voiceUnsupported"));
      return;
    }

    try {
      const recognition = new SpeechRecognitionApi();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
      voiceBaseTextRef.current = input.trim();

      recognition.onresult = (event) => {
        const transcripts = [];
        for (let index = 0; index < event.results.length; index += 1) {
          transcripts.push(event.results[index][0]?.transcript || "");
        }

        const spokenText = transcripts.join(" ").replace(/\s+/g, " ").trim();
        const baseText = voiceBaseTextRef.current;
        setInput([baseText, spokenText].filter(Boolean).join(" "));
      };

      recognition.onerror = (event) => {
        setVoiceError(event.error === "not-allowed" ? t("microphoneDenied") : t("voiceInputStopped"));
        setListening(false);
      };

      recognition.onend = () => {
        setListening(false);
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
      playVoiceTone("start");
      textareaRef.current?.focus();
    } catch {
      setVoiceError(t("couldNotStartVoiceInput"));
      setListening(false);
    }
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

  const publicAttachment = (attachment: Attachment) => {
    const copy = { ...attachment };
    delete copy.dataUrl;
    delete copy.text;
    return copy;
  };

  const outboundAttachment = (attachment: Attachment) => {
    const copy: Partial<Attachment> = { ...attachment };
    delete copy.id;
    return copy as Omit<Attachment, "id">;
  };

  const formatReply = (data: ChatResponse) => {
    const reply = data.reply || data.error || t("noResponseFromAi");
    if (!data.fallbackFrom) return reply;

    const reason = data.fallbackError?.message
      ? ` ${data.fallbackError.message}`
      : "";

    return `${t("fallbackNotice")} ${modelLabel(data.fallbackFrom)} ${t("fallbackUnavailable")}.${reason} ${t("answeredWith")} ${modelLabel(data.model || model)} ${t("instead")}.\n\n${reply}`;
  };

  const hasConversation = messages.length > 0;
  const quickActions = [
    { label: t("helpMeWrite"), prompt: `${t("helpMeWrite")} `, icon: PenLine },
    { label: t("learnAbout"), prompt: `${t("learnAbout")} `, icon: BookOpen },
    { label: t("analyzeImage"), prompt: `${t("analyzeImage")}: `, icon: Search },
    { label: t("summarizeText"), prompt: `${t("summarizeText")}: `, icon: AlignLeft },
    { label: t("analyzeData"), prompt: `${t("analyzeData")}: `, icon: ChartLine },
    { label: t("brainstorm"), prompt: `${t("brainstorm")} `, icon: Brain },
    { label: t("improveWriting"), prompt: `${t("improveWriting")}: `, icon: Type },
    { label: t("translate"), prompt: `${t("translate")}: `, icon: Languages },
    { label: t("generateImages"), prompt: `${t("generateImages")} `, icon: ImageIcon },
    { label: t("generateIdeas"), prompt: `${t("generateIdeas")} `, icon: Lightbulb },
  ];
  const visibleQuickActions = quickActions.slice(0, 4);
  const hiddenQuickActions = quickActions.slice(4);

  const LoadingDots = () => (
    <span className="inline-flex items-center gap-1 py-1">
      {[0, 1, 2].map((dot) => (
        <motion.span
          key={dot}
          className="h-1.5 w-1.5 rounded-full bg-[color:var(--muted)]"
          animate={{ opacity: [0.35, 1, 0.35], y: [0, -3, 0] }}
          transition={{ duration: 1, repeat: Infinity, delay: dot * 0.15 }}
        />
      ))}
    </span>
  );

  const renderComposer = (showQuickActions = false) => (
    <div className="mx-auto w-full max-w-3xl px-4">
      {attachmentError && (
        <p className="mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
          {attachmentError}
        </p>
      )}
      {(voiceError || listening) && (
        <div
          className={`mb-2 flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
            voiceError
              ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200"
              : "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-300"
          }`}
        >
          {listening && !voiceError && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            </span>
          )}
          <span>{voiceError || t("listeningMessage")}</span>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <span
              key={attachment.id}
              className="inline-flex max-w-full items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-2 py-1 text-xs text-[color:var(--muted)] shadow-sm"
            >
              {attachment.kind === "image" ? <ImageIcon size={13} /> : <FileText size={13} />}
              <span className="truncate">{attachment.name}</span>
              <span>{formatFileSize(attachment.size)}</span>
              <button
                type="button"
                onClick={() => removeAttachment(attachment.id)}
                className="rounded-sm p-0.5 hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]"
                title={`${t("removeAttachment")} ${attachment.name}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <motion.div
        layout
        layoutId="chat-composer"
        transition={{ layout: { duration: 0.52, ease: [0.22, 1, 0.36, 1] } }}
        className="group flex items-end gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-2 shadow-[var(--composer-shadow)] transition duration-200 focus-within:border-[color:var(--accent)]"
      >
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setAttachMenuOpen((open) => !open)}
            className="icon-btn shrink-0"
            title={t("attach")}
            aria-expanded={attachMenuOpen}
            aria-haspopup="menu"
          >
            <Paperclip size={18} />
          </button>
          {attachMenuOpen && (
            <div className="menu-surface absolute bottom-11 left-0 z-20 w-48 overflow-hidden p-1" role="menu">
              <button
                type="button"
                onClick={() => openFilePicker("photos")}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-[color:var(--surface-muted)]"
                role="menuitem"
              >
                <ImageIcon size={16} />
                {t("photos")}
              </button>
              <button
                type="button"
                onClick={() => openFilePicker("documents")}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-[color:var(--surface-muted)]"
                role="menuitem"
              >
                <FileText size={16} />
                {t("document")}
              </button>
              <button
                type="button"
                onClick={() => openFilePicker("camera")}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-[color:var(--surface-muted)]"
                role="menuitem"
              >
                <Camera size={16} />
                {t("camera")}
              </button>
            </div>
          )}
        </div>
        <input
          ref={photosInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={documentsInputRef}
          type="file"
          accept=".txt,.md,.csv,.json,.tsv,.log,.xml,.html,.css,.js,.jsx,.ts,.tsx,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
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
          placeholder={t("messagePlaceholder")}
          rows={1}
          className="max-h-44 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm leading-6 outline-none placeholder:text-[color:var(--muted)]"
        />
        <button
          type="button"
          onClick={toggleVoiceInput}
          disabled={!speechSupported || sending}
          className={`relative h-11 min-h-11 w-11 rounded-xl border transition duration-200 ${
            listening
              ? "border-red-500/40 bg-red-500/10 text-red-600 shadow-[0_0_0_4px_rgba(239,68,68,0.08)] hover:bg-red-500/15 dark:text-red-300"
              : "border-transparent text-[color:var(--muted)] hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]"
          }`}
          title={speechSupported ? (listening ? t("stopVoiceInput") : t("startVoiceInput")) : t("voiceUnsupported")}
          aria-pressed={listening}
        >
          {listening && <span className="absolute inset-1 rounded-lg border border-red-500/30 animate-pulse" />}
          <span className="relative inline-flex items-center justify-center">
            {listening ? <MicOff size={17} /> : <Mic size={17} />}
          </span>
        </button>
        <button
          type="button"
          onClick={sendMessage}
          disabled={(!input.trim() && attachments.length === 0) || sending}
          className="btn-primary h-11 min-h-11 w-11 rounded-xl px-0"
          title={t("sendMessage")}
        >
          <Send size={17} />
        </button>
      </motion.div>

      {showQuickActions && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {[...visibleQuickActions, ...(quickActionsOpen ? hiddenQuickActions : [])].map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                type="button"
                onClick={() => {
                  setInput(action.prompt);
                  window.setTimeout(() => textareaRef.current?.focus(), 0);
                }}
                className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-3.5 text-sm font-medium text-[color:var(--foreground)] shadow-sm transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
              >
                <Icon size={16} />
                {action.label}
              </button>
            );
          })}
          {hiddenQuickActions.length > 0 && (
            <button
              type="button"
              onClick={() => setQuickActionsOpen((open) => !open)}
              className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-3.5 text-sm font-medium text-[color:var(--foreground)] shadow-sm transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
              aria-expanded={quickActionsOpen}
            >
              <Sparkles size={16} />
              {quickActionsOpen ? t("seeLess") : t("seeMore")}
            </button>
          )}
        </div>
      )}
    </div>
  );

  const sendMessage = async () => {
    const trimmed = input.trim();
    if ((!trimmed && attachments.length === 0) || sending) return;

    setInput("");
    const attachmentsToSend = attachments;
    setAttachments([]);
    setSending(true);

    const finalChatId = activeChatId || crypto.randomUUID();
    if (!activeChatId) {
      sessionStorage.setItem("rvk:optimisticChatId", finalChatId);
      setActiveChatId?.(finalChatId);
    }

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: trimmed || t("analyzeAttachedFile"),
        attachments: attachmentsToSend.map(publicAttachment),
      },
      { role: "assistant", content: t("thinking") },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed || t("analyzeAttachedFile"),
          chatId: finalChatId,
          model,
          attachments: attachmentsToSend.map(outboundAttachment),
        }),
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
      sessionStorage.removeItem("rvk:optimisticChatId");
    } catch (error) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: error instanceof Error ? error.message : t("failedToConnectAi"),
        };
        return updated;
      });
    } finally {
      setSending(false);
      sessionStorage.removeItem("rvk:optimisticChatId");
    }
  };

  return (
    <section className="relative flex h-screen min-w-0 flex-1 flex-col overflow-hidden bg-[color:var(--background)]">
      <header
        className={`z-20 flex h-16 shrink-0 items-center justify-between bg-[color:var(--background)] px-4 transition-[border-color,box-shadow] duration-200 ${
          chatScrolled ? "border-b border-[color:var(--border)] shadow-sm" : "border-b border-transparent"
        }`}
      >
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

        <div className="flex items-center gap-2">
          <ThemeToggle className="icon-btn h-10 w-10 border border-[color:var(--border)] bg-[color:var(--surface)]" />
        </div>
      </header>

      <AnimatePresence mode="wait">
        {!hasConversation && (
          <motion.div
            key="welcome"
            className="absolute inset-x-0 bottom-0 top-16 flex items-center justify-center overflow-y-auto px-4 py-8"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -24 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="w-full">
              <div className="mx-auto max-w-3xl text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--surface-muted)] text-[color:var(--accent)] shadow-sm">
                  <Bot size={23} />
                </div>
                <h2 className="mt-5 text-2xl font-semibold tracking-normal text-[color:var(--foreground)] sm:text-3xl">
                  {t("welcomeTitle")}
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[color:var(--muted)]">
                  {t("welcomeDescription")}
                </p>
              </div>
              <div className="mt-8">
                {renderComposer(true)}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        ref={scrollRef}
        onScroll={handleChatScroll}
        className={`flex-1 overflow-y-auto px-4 py-6 transition-[padding] duration-300 ${
          hasConversation ? "pb-40" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          <AnimatePresence initial={false}>
            {messages.map((msg, index) => {
              const isUser = msg.role === "user";
              const isThinking = !isUser && msg.content === t("thinking");
              return (
                <motion.div
                  key={`${msg._id || index}`}
                  layout
                  initial={{ opacity: 0, y: 18, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                  className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
                >
                  {!isUser && (
                    <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent)] text-white">
                      <Bot size={17} />
                    </div>
                  )}

                  <div className={`group min-w-0 max-w-[82%] ${isUser ? "items-end" : "items-start"}`}>
                    <div
                      className={`rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                        isUser
                          ? "bg-[color:var(--accent)] text-white"
                          : "border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--foreground)]"
                      }`}
                    >
                      {isThinking ? (
                        <LoadingDots />
                      ) : (
                        <div className="message-markdown">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      )}
                      {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {msg.attachments.map((attachment: Attachment, attachmentIndex: number) => (
                            <span
                              key={`${attachment.name}-${attachmentIndex}`}
                              className={`inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs ${
                                isUser
                                  ? "bg-white/15 text-white"
                                  : "bg-[color:var(--surface-muted)] text-[color:var(--muted)]"
                              }`}
                            >
                              {attachment.kind === "image" ? <ImageIcon size={13} /> : <FileText size={13} />}
                              <span className="truncate">{attachment.name}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {!isThinking && (
                      <button
                        type="button"
                        onClick={() => handleCopy(msg.content, index)}
                        className="mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[color:var(--muted)] opacity-0 transition hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)] group-hover:opacity-100"
                      >
                        {copiedIndex === index ? <Check size={13} /> : <Copy size={13} />}
                        {copiedIndex === index ? t("copied") : t("copy")}
                      </button>
                    )}
                  </div>

                  {isUser && (
                    <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--surface-muted)] text-[color:var(--muted)]">
                      <User size={17} />
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {hasConversation && (
          <motion.div
            key="bottom-composer"
            className="pointer-events-none absolute inset-x-0 bottom-4 z-20"
            initial={{ opacity: 0, y: 90 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 90 }}
            transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="pointer-events-auto">{renderComposer()}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
