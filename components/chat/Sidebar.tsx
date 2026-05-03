"use client";

import { useSession, signOut } from "next-auth/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Clock,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

export default function Sidebar({
  activeChatId,
  setActiveChatId,
  sidebarOpen,
  setSidebarOpen,
  refreshKey,
}: any) {
  const { data: session } = useSession();
  const [search, setSearch] = useState("");
  const [chats, setChats] = useState<any[]>([]);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [showRecents, setShowRecents] = useState(true);
  const [showAccount, setShowAccount] = useState(false);
  const [theme, setTheme] = useState("dark");

  const menuRef = useRef<HTMLDivElement | null>(null);
  const accountRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  const loadChats = async () => {
    const res = await fetch("/api/thread");
    const data = await res.json();
    setChats(data.threads || []);
  };

  useEffect(() => {
    loadChats();
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
    const newChat = { chatId: crypto.randomUUID(), title: "New Chat" };

    await fetch("/api/thread", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newChat),
    });

    setActiveChatId(newChat.chatId);
    await loadChats();
  };

  const updateChat = async (payload: any) => {
    await fetch("/api/thread", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setMenuOpenId(null);
    await loadChats();
  };

  const deleteChat = async (chat: any) => {
    await fetch("/api/thread", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: chat.chatId }),
    });
    if (activeChatId === chat.chatId) setActiveChatId(null);
    setMenuOpenId(null);
    await loadChats();
  };

  const renameChat = (chat: any) => {
    const title = prompt("Rename chat", chat.title);
    if (!title?.trim()) return;
    updateChat({ chatId: chat.chatId, title: title.trim() });
  };

  const userInitial = session?.user?.name?.charAt(0)?.toUpperCase() || session?.user?.email?.charAt(0)?.toUpperCase() || "U";

  const ChatItem = ({ chat }: any) => {
    const selected = activeChatId === chat.chatId;

    return (
      <div
        className={`group relative flex items-center gap-2 rounded-lg px-2 py-2 text-sm ${
          selected
            ? "bg-[color:var(--surface-muted)] text-[color:var(--foreground)]"
            : "text-[color:var(--muted)] hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]"
        }`}
      >
        <button type="button" onClick={() => setActiveChatId(chat.chatId)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">
            {chat.pinned ? <Pin size={15} /> : <MessageSquare size={15} />}
          </span>
          <span className="truncate">{chat.title || "Untitled chat"}</span>
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
          <MoreHorizontal size={16} />
        </button>

        {menuOpenId === chat.chatId && (
          <div ref={menuRef} className="menu-surface absolute right-2 top-10 z-[80] w-44 p-1">
            <button type="button" onClick={() => updateChat({ chatId: chat.chatId, pinned: !chat.pinned })} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-[color:var(--surface-muted)]">
              <Pin size={15} />
              {chat.pinned ? "Unpin" : "Pin"}
            </button>
            <button type="button" onClick={() => renameChat(chat)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-[color:var(--surface-muted)]">
              <Pencil size={15} />
              Rename
            </button>
            <button type="button" onClick={() => updateChat({ chatId: chat.chatId, archived: !chat.archived })} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-[color:var(--surface-muted)]">
              <Archive size={15} />
              {chat.archived ? "Unarchive" : "Archive"}
            </button>
            <button type="button" onClick={() => deleteChat(chat)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10">
              <Trash2 size={15} />
              Delete
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className={`flex h-screen shrink-0 flex-col border-r border-[color:var(--border)] bg-[color:var(--surface)] transition-[width] duration-200 ${sidebarOpen ? "w-80" : "w-16"}`}>
      <div className="flex h-16 items-center gap-2 border-b border-[color:var(--border)] px-3">
        <button type="button" onClick={() => setSidebarOpen(!sidebarOpen)} className="icon-btn" title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}>
          {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
        {sidebarOpen && <span className="font-semibold">RVKBot</span>}
      </div>

      {sidebarOpen ? (
        <>
          <div className="space-y-3 border-b border-[color:var(--border)] p-3">
            <button type="button" onClick={createChat} className="btn-primary w-full">
              <Plus size={17} />
              New chat
            </button>
            <div className="relative flex h-10 items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] focus-within:border-[color:var(--accent)] focus-within:ring-3 focus-within:ring-teal-500/10">
              <Search size={16} className="pointer-events-none absolute left-3 shrink-0 text-[color:var(--muted)]" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chats"
                className="h-full w-full rounded-lg bg-transparent pl-10 pr-3 text-sm text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--muted)]"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <button type="button" onClick={() => setShowArchive(!showArchive)} className="mb-2 flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm font-semibold text-[color:var(--muted)] hover:bg-[color:var(--surface-muted)]">
              <span className="flex items-center gap-2">
                <Archive size={16} />
                Archived
              </span>
              <span>{archived.length}</span>
            </button>
            {showArchive && <div className="space-y-1">{archived.map((chat) => <ChatItem key={chat._id || chat.chatId} chat={chat} />)}</div>}

            <button type="button" onClick={() => setShowRecents(!showRecents)} className="mb-2 mt-5 flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm font-semibold text-[color:var(--muted)] hover:bg-[color:var(--surface-muted)]">
              <span className="flex items-center gap-2">
                <Clock size={16} />
                Recents
              </span>
              <span>{recents.length}</span>
            </button>
            {showRecents && <div className="space-y-1">{recents.map((chat) => <ChatItem key={chat._id || chat.chatId} chat={chat} />)}</div>}
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center gap-3 p-3">
          <button type="button" onClick={createChat} className="icon-btn" title="New chat">
            <Plus size={18} />
          </button>
          <button
            type="button"
            onClick={() => {
              setSidebarOpen(true);
              window.setTimeout(() => searchRef.current?.focus(), 0);
            }}
            className="icon-btn"
            title="Search chats"
          >
            <Search size={18} />
          </button>
          <button
            type="button"
            onClick={() => {
              setSidebarOpen(true);
              setShowArchive(true);
              setShowRecents(false);
            }}
            className="icon-btn"
            title="Archived chats"
          >
            <Archive size={18} />
          </button>
          <button
            type="button"
            onClick={() => {
              setSidebarOpen(true);
              setShowRecents(true);
              setShowArchive(false);
            }}
            className="icon-btn"
            title="Recent chats"
          >
            <Clock size={18} />
          </button>
        </div>
      )}

      <div className="relative border-t border-[color:var(--border)] p-3">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpenId(null);
            setShowAccount(!showAccount);
          }}
          className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-[color:var(--surface-muted)]"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent)] font-semibold text-white">{userInitial}</span>
          {sidebarOpen && (
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{session?.user?.name || "User"}</span>
              <span className="block truncate text-xs text-[color:var(--muted)]">{session?.user?.email || "No email"}</span>
            </span>
          )}
        </button>

        {showAccount && (
          <div ref={accountRef} className="menu-surface absolute bottom-16 left-3 z-[90] w-64 p-3">
            <p className="truncate font-semibold">{session?.user?.name || "User"}</p>
            <p className="mt-1 truncate text-sm text-[color:var(--muted)]">{session?.user?.email || "No email available"}</p>
            <button type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="btn-secondary mt-4 w-full">
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            <button type="button" onClick={() => signOut({ callbackUrl: "/" })} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
              <LogOut size={16} />
              Logout
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
