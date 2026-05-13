"use client";

import { useSession, signOut } from "next-auth/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { applyTheme, useTheme } from "@/components/ui/ThemeToggle";
import { appLanguages, applyLanguage, useAppTranslation, useLanguage } from "@/components/ui/Language";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronRight,
  History,
  Languages,
  LogOut,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  Plus,
  Search,
  Sun,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

type ChatThread = {
  _id?: string;
  chatId: string;
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type ThreadPayload = {
  chatId: string;
  title?: string;
  pinned?: boolean;
  archived?: boolean;
};

type SidebarProps = {
  activeChatId?: string | null;
  setActiveChatId: (chatId: string | null) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  refreshKey?: number;
};

export default function Sidebar({
  activeChatId,
  setActiveChatId,
  sidebarOpen,
  setSidebarOpen,
  refreshKey,
}: SidebarProps) {
  const { data: session, update: updateSession } = useSession();
  const [search, setSearch] = useState("");
  const [chats, setChats] = useState<ChatThread[]>([]);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [showRecents, setShowRecents] = useState(true);
  const [showAccount, setShowAccount] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileStatus, setProfileStatus] = useState("");
  const [savingField, setSavingField] = useState<"name" | "email" | null>(null);
  const theme = useTheme();
  const language = useLanguage();
  const t = useAppTranslation();

  const menuRef = useRef<HTMLDivElement | null>(null);
  const accountRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const loadChats = async () => {
    const res = await fetch("/api/thread");
    const data = await res.json();
    setChats(data.threads || []);
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const res = await fetch("/api/thread");
      const data = await res.json();
      if (!cancelled) setChats(data.threads || []);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setMenuOpenId(null);
      }
      if (accountRef.current && !accountRef.current.contains(target)) {
        setShowAccount(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setProfileName(session?.user?.name || "");
    setProfileEmail(session?.user?.email || "");
  }, [session?.user?.email, session?.user?.name]);

  const filtered = useMemo(
    () => chats.filter((chat) => chat.title?.toLowerCase().includes(search.toLowerCase())),
    [chats, search]
  );

  const sortedChats = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt || 0).getTime() -
          new Date(a.updatedAt || a.createdAt || 0).getTime()
      ),
    [filtered]
  );

  const recents = sortedChats.filter((chat) => !chat.archived);
  const archived = sortedChats.filter((chat) => chat.archived);

  const createChat = async () => {
    const newChat = { chatId: crypto.randomUUID(), title: t("newChat") };

    await fetch("/api/thread", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newChat),
    });

    setActiveChatId(newChat.chatId);
    await loadChats();
  };

  const updateChat = async (payload: ThreadPayload) => {
    await fetch("/api/thread", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setMenuOpenId(null);
    await loadChats();
  };

  const deleteChat = async (chat: ChatThread) => {
    await fetch("/api/thread", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: chat.chatId }),
    });
    if (activeChatId === chat.chatId) setActiveChatId(null);
    setMenuOpenId(null);
    await loadChats();
  };

  const renameChat = (chat: ChatThread) => {
    const title = prompt(t("renameChatPrompt"), chat.title);
    if (!title?.trim()) return;
    updateChat({ chatId: chat.chatId, title: title.trim() });
  };

  const userInitial = session?.user?.name?.charAt(0)?.toUpperCase() || session?.user?.email?.charAt(0)?.toUpperCase() || "U";

  const saveProfileField = async (field: "name" | "email") => {
    setProfileStatus("");
    setSavingField(field);

    try {
      const value = field === "name" ? profileName : profileEmail;
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const data = await res.json();

      if (!res.ok) {
        setProfileStatus(data.error || t("unableToUpdateProfile"));
        return;
      }

      await updateSession({ user: data.user });
      setProfileName(data.user.name || "");
      setProfileEmail(data.user.email || "");
      setProfileStatus(field === "name" ? t("nameUpdated") : t("emailUpdated"));
    } catch {
      setProfileStatus(t("unableToUpdateProfile"));
    } finally {
      setSavingField(null);
    }
  };

  const openProfile = () => {
    setShowAccount(false);
    setShowProfile(true);
    setProfileStatus("");
  };

  const ChatItem = ({ chat }: { chat: ChatThread }) => {
    const selected = activeChatId === chat.chatId;

    return (
      <div
        className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${
          selected
            ? "bg-[color:var(--surface)] text-[color:var(--foreground)] shadow-sm"
            : "text-[color:var(--muted)] hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]"
        }`}
      >
        <button type="button" onClick={() => setActiveChatId(chat.chatId)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[color:var(--muted)]">
            {chat.pinned ? <Pin size={14} /> : <MessageSquare size={14} />}
          </span>
          <span className="truncate text-xs font-medium">{chat.title || t("untitledChat")}</span>
        </button>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setShowAccount(false);
            setMenuOpenId(menuOpenId === chat.chatId ? null : chat.chatId);
          }}
          className="icon-btn h-7 w-7 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        >
          <MoreHorizontal size={15} />
        </button>

        {menuOpenId === chat.chatId && (
          <div ref={menuRef} className="menu-surface absolute right-2 top-10 z-[80] w-44 p-1">
            <button type="button" onClick={() => updateChat({ chatId: chat.chatId, pinned: !chat.pinned })} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-[color:var(--surface-muted)]">
              <Pin size={14} />
              {chat.pinned ? t("unpin") : t("pin")}
            </button>
            <button type="button" onClick={() => renameChat(chat)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-[color:var(--surface-muted)]">
              <Pencil size={14} />
              {t("rename")}
            </button>
            <button type="button" onClick={() => updateChat({ chatId: chat.chatId, archived: !chat.archived })} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-[color:var(--surface-muted)]">
              <Archive size={14} />
              {chat.archived ? t("unarchive") : t("archive")}
            </button>
            <button type="button" onClick={() => deleteChat(chat)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10">
              <Trash2 size={14} />
              {t("delete")}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className={`chat-sidebar flex h-screen shrink-0 flex-col border-r border-[color:var(--border)] transition-[width] duration-200 ${sidebarOpen ? "w-72" : "w-14"}`}>
      <div className="flex h-14 items-center gap-2 px-2.5">
        <button type="button" onClick={() => setSidebarOpen(!sidebarOpen)} className="icon-btn h-8 w-8" title={sidebarOpen ? t("collapseSidebar") : t("expandSidebar")}>
          {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
        </button>
        {sidebarOpen && <span className="text-sm font-semibold tracking-normal">RVK</span>}
      </div>

      {sidebarOpen ? (
        <>
          <div className="space-y-1 px-2.5 pb-2">
            <button type="button" onClick={createChat} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--accent)]">
              <Plus size={16} />
              {t("newChat")}
            </button>
            <div className="relative flex h-9 items-center rounded-lg focus-within:bg-[color:var(--surface-muted)]">
              <Search size={15} className="pointer-events-none absolute left-3 shrink-0 text-[color:var(--muted)]" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("searchChats")}
                className="h-full w-full rounded-lg bg-transparent pl-9 pr-3 text-xs text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--muted)]"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2.5 py-2">
            <button type="button" onClick={() => setShowArchive(!showArchive)} className="mb-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-medium text-[color:var(--muted)] hover:bg-[color:var(--surface-muted)]">
              <span className="flex items-center gap-2">
                <ArchiveRestore size={14} />
                {t("archived")}
              </span>
              <span>{archived.length}</span>
            </button>
            {showArchive && <div className="space-y-1">{archived.map((chat) => <ChatItem key={chat._id || chat.chatId} chat={chat} />)}</div>}

            <button type="button" onClick={() => setShowRecents(!showRecents)} className="mb-1 mt-4 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-medium text-[color:var(--muted)] hover:bg-[color:var(--surface-muted)]">
              <span className="flex items-center gap-2">
                <History size={14} />
                {t("recents")}
              </span>
              <span>{recents.length}</span>
            </button>
            {showRecents && <div className="space-y-1">{recents.map((chat) => <ChatItem key={chat._id || chat.chatId} chat={chat} />)}</div>}
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center gap-2 p-2.5">
          <button type="button" onClick={createChat} className="icon-btn h-8 w-8" title={t("newChat")}>
            <Plus size={17} />
          </button>
          <button
            type="button"
            onClick={() => {
              setSidebarOpen(true);
              window.setTimeout(() => searchRef.current?.focus(), 0);
            }}
            className="icon-btn h-8 w-8"
            title={t("searchChats")}
          >
            <Search size={17} />
          </button>
          <button
            type="button"
            onClick={() => {
              setSidebarOpen(true);
              setShowArchive(true);
              setShowRecents(false);
            }}
            className="icon-btn h-8 w-8"
            title={t("archivedChats")}
          >
            <ArchiveRestore size={17} />
          </button>
          <button
            type="button"
            onClick={() => {
              setSidebarOpen(true);
              setShowRecents(true);
              setShowArchive(false);
            }}
            className="icon-btn h-8 w-8"
            title={t("recentChats")}
          >
            <History size={17} />
          </button>
        </div>
      )}

      <div className="relative p-2.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpenId(null);
            setShowAccount(!showAccount);
          }}
          className={`flex w-full items-center gap-2 rounded-lg border p-1.5 text-left transition ${
            showAccount
              ? "border-[color:var(--accent)] bg-[color:var(--surface-muted)]"
              : "border-transparent hover:border-[color:var(--border)] hover:bg-[color:var(--surface-muted)]"
          }`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent)] text-xs font-semibold text-white shadow-sm">{userInitial}</span>
          {sidebarOpen && (
            <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold">{session?.user?.name || t("user")}</span>
              </span>
              <ChevronRight size={15} className={`shrink-0 text-[color:var(--muted)] transition ${showAccount ? "rotate-90" : ""}`} />
            </span>
          )}
        </button>

        {showAccount && (
          <div ref={accountRef} className="menu-surface absolute bottom-14 left-2.5 z-[90] w-64 overflow-hidden p-2">
            <div className="pb-2">
              <button type="button" onClick={openProfile} className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium hover:bg-[color:var(--surface-muted)]">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--surface-muted)] text-[color:var(--muted)]">
                    <UserRound size={16} />
                  </span>
                  <span>
                    <span className="block text-sm">{t("myProfile")}</span>
                    <span className="block text-xs font-normal text-[color:var(--muted)]">{t("accountAndPreferences")}</span>
                  </span>
                </span>
                <ChevronRight size={16} className="text-[color:var(--muted)]" />
              </button>

              <button type="button" onClick={() => applyTheme(theme === "dark" ? "light" : "dark")} className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium hover:bg-[color:var(--surface-muted)]">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--surface-muted)] text-[color:var(--muted)]">
                    {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                  </span>
                  <span>
                    <span className="block text-sm">{theme === "dark" ? t("switchToLight") : t("switchToDark")}</span>
                    <span className="block text-xs font-normal text-[color:var(--muted)]">{t("current")}: {theme === "dark" ? t("dark") : t("light")}</span>
                  </span>
                </span>
                <ChevronRight size={16} className="text-[color:var(--muted)]" />
              </button>
            </div>

            <div className="border-t border-[color:var(--border)] p-2">
              <button type="button" onClick={() => signOut({ callbackUrl: "/" })} className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                <LogOut size={16} />
                {t("logout")}
              </button>
            </div>
          </div>
        )}
      </div>

      {showProfile && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="menu-surface w-full max-w-lg overflow-hidden shadow-[0_24px_90px_rgba(0,0,0,0.3)]">
            <div className="flex items-start justify-between gap-4 border-b border-[color:var(--border)] bg-[color:var(--surface-muted)] px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent)] text-lg font-semibold text-white shadow-sm">{userInitial}</span>
                <span className="min-w-0">
                  <span className="block text-lg font-semibold">{t("myProfile")}</span>
                  <span className="block truncate text-sm text-[color:var(--muted)]">{session?.user?.email || t("noEmailAvailable")}</span>
                </span>
              </div>
              <button type="button" onClick={() => setShowProfile(false)} className="icon-btn shrink-0 bg-[color:var(--surface)]" aria-label={t("closeProfile")}>
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[min(78vh,680px)] overflow-y-auto px-5 py-5">
              <div className="space-y-6">
                <section>
                  <div className="mb-3">
                    <p className="text-sm font-semibold">{t("accountDetails")}</p>
                    <p className="mt-1 text-xs text-[color:var(--muted)]">{t("profileDescription")}</p>
                  </div>

                  <div className="space-y-3">
                    <label className="block">
                      <span className="mb-2 flex items-center gap-2 text-sm font-medium text-[color:var(--muted)]">
                        <UserRound size={15} />
                        {t("name")}
                      </span>
                      <div className="flex gap-2">
                        <input value={profileName} onChange={(e) => setProfileName(e.target.value)} className="field min-w-0 flex-1" />
                        <button type="button" onClick={() => saveProfileField("name")} disabled={savingField !== null} className="btn-primary px-4">
                          {savingField === "name" ? t("updating") : t("update")}
                        </button>
                      </div>
                    </label>

                    <label className="block">
                      <span className="mb-2 flex items-center gap-2 text-sm font-medium text-[color:var(--muted)]">
                        <Mail size={15} />
                        {t("email")}
                      </span>
                      <div className="flex gap-2">
                        <input value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} className="field min-w-0 flex-1" />
                        <button type="button" onClick={() => saveProfileField("email")} disabled={savingField !== null} className="btn-primary px-4">
                          {savingField === "email" ? t("updating") : t("update")}
                        </button>
                      </div>
                    </label>
                  </div>
                </section>

                <section className="border-t border-[color:var(--border)] pt-5">
                  <div className="mb-3">
                    <p className="text-sm font-semibold">{t("preferences")}</p>
                    <p className="mt-1 text-xs text-[color:var(--muted)]">{t("preferencesDescription")}</p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <span className="mb-2 block text-sm font-medium text-[color:var(--muted)]">{t("theme")}</span>
                      <div className="grid grid-cols-2 gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-1">
                        <button type="button" onClick={() => applyTheme("light")} className={`flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition ${theme === "light" ? "bg-[color:var(--surface)] text-[color:var(--foreground)] shadow-sm" : "text-[color:var(--muted)] hover:text-[color:var(--foreground)]"}`}>
                          <Sun size={16} />
                          {t("light")}
                          {theme === "light" && <Check size={15} />}
                        </button>
                        <button type="button" onClick={() => applyTheme("dark")} className={`flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition ${theme === "dark" ? "bg-[color:var(--surface)] text-[color:var(--foreground)] shadow-sm" : "text-[color:var(--muted)] hover:text-[color:var(--foreground)]"}`}>
                          <Moon size={16} />
                          {t("dark")}
                          {theme === "dark" && <Check size={15} />}
                        </button>
                      </div>
                    </div>

                    <label className="block">
                      <span className="mb-2 flex items-center gap-2 text-sm font-medium text-[color:var(--muted)]">
                        <Languages size={15} />
                        {t("language")}
                      </span>
                      <select value={language} onChange={(e) => applyLanguage(e.target.value as typeof language)} className="field cursor-pointer">
                        {appLanguages.map((item) => (
                          <option key={item.code} value={item.code}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </section>

                {profileStatus && (
                  <p className={`rounded-lg border px-3 py-2 text-sm ${profileStatus.includes("updated") ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200" : "border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200"}`}>
                    {profileStatus}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
