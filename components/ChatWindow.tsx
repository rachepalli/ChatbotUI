// components/ChatWindow.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import Message from "./Message";
import InputArea from "./InputArea";

type MessageType = {
  id: string;
  content: string;
  role: "user" | "assistant";
  timestamp: string;
};

type Chat = {
  id: string;
  title: string;
  messages: MessageType[];
};

export default function ChatWindow() {
  const [isDark, setIsDark] = useState(false);
  const [chats, setChats] = useState<Chat[]>([
    {
      id: "chat-1",
      title: "Chat 1",
      messages: [
        {
          id: "m1",
          content: "Hello! How can I help you today?",
          role: "assistant",
          timestamp: "11:28",
        },
      ],
    },
  ]);
  const [activeChatId, setActiveChatId] = useState<string>("chat-1");
  const [loading, setLoading] = useState(false);
  const [botTyping, setBotTyping] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeChat = chats.find((chat) => chat.id === activeChatId);

  const getTime = (): string =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const playNotification = () => {
    try {
      const audio = new Audio("/notify.mp3");
      audio.volume = 0.7;
      audio.play();
    } catch (_) {}
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.messages, botTyping, loading]);

  const handleSend = async (text: string) => {
    if (!text.trim() || !activeChatId) return;

    const userMessage: MessageType = {
      id: Date.now().toString(),
      content: text,
      role: "user",
      timestamp: getTime(),
    };

    setChats((prev) =>
      prev.map((chat) =>
        chat.id === activeChatId
          ? { ...chat, messages: [...chat.messages, userMessage] }
          : chat
      )
    );

    setLoading(true);
    setBotTyping(true);

    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      const data = await res.json();

      const botMessage: MessageType = {
        id: (Date.now() + 1).toString(),
        content: data.reply || "Meow! That's an interesting question 🐱",
        role: "assistant",
        timestamp: getTime(),
      };

      setChats((prev) =>
        prev.map((chat) =>
          chat.id === activeChatId
            ? { ...chat, messages: [...chat.messages, botMessage] }
            : chat
        )
      );

      playNotification();
    } catch {
      const errorMsg: MessageType = {
        id: (Date.now() + 2).toString(),
        content: "Sorry, something went wrong. Please try again later.",
        role: "assistant",
        timestamp: getTime(),
      };
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === activeChatId
            ? { ...chat, messages: [...chat.messages, errorMsg] }
            : chat
        )
      );
    } finally {
      setLoading(false);
      setBotTyping(false);
    }
  };

  const handleNewChat = () => {
    const newChat: Chat = {
      id: Date.now().toString(),
      title: `Chat ${chats.length + 1}`,
      messages: [],
    };
    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newChat.id);
  };

  const clearCurrentChat = () => {
    if (!activeChatId) return;
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === activeChatId ? { ...chat, messages: [] } : chat
      )
    );
  };

  const deleteChat = (chatId: string) => {
    if (!confirm("Are you sure you want to delete this chat?")) return;

    setChats((prev) => prev.filter((chat) => chat.id !== chatId));

    if (chatId === activeChatId) {
      const remainingChats = chats.filter((chat) => chat.id !== chatId);
      if (remainingChats.length > 0) {
        setActiveChatId(remainingChats[0].id);
      } else {
        handleNewChat();
      }
    }
  };

  const BotTyping = () => (
    <div
      style={{
        alignSelf: "flex-start",
        background: isDark ? "#374151" : "#f1f5f9",
        padding: "12px 22px",
        borderRadius: "20px",
        display: "flex",
        alignItems: "center",
        gap: "6px",
      }}
    >
      <div style={{ display: "flex", gap: "5px" }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: "8px",
              height: "8px",
              backgroundColor: isDark ? "#22d3ee" : "#06b6d4",
              borderRadius: "50%",
              animation: `bounce 1.2s infinite ease-in-out`,
              animationDelay: `${i * 0.15}s`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }
      `}</style>
    </div>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: isDark ? "#0f172a" : "#f8f4ff",   // Soft lavender background
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Top Navbar - New Colors */}
      <div
        style={{
          height: "68px",
          background: isDark ? "#1e2937" : "#e0d4ff",
          borderBottom: `1px solid ${isDark ? "#334155" : "#c4b5fd"}`,
          display: "flex",
          alignItems: "center",
          padding: "0 30px",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <span style={{ fontSize: "32px" }}>🐱</span>
          <div>
            <div style={{ 
              fontSize: "24px", 
              fontWeight: "600", 
              color: isDark ? "#67e8f9" : "#4c1d95" 
            }}>
              Meow Chatbot
            </div>
            <div style={{ fontSize: "13px", opacity: 0.8 }}>Metawurks AI Assistant</div>
          </div>
        </div>

        <button
          onClick={() => setIsDark(!isDark)}
          style={{
            padding: "10px 22px",
            borderRadius: "30px",
            border: "none",
            background: isDark ? "#334155" : "#fff",
            color: isDark ? "#67e8f9" : "#4c1d95",
            fontWeight: "600",
            cursor: "pointer",
          }}
        >
          {isDark ? "☀️ Light Mode" : "🌙 Dark Mode"}
        </button>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sidebar - New Colors */}
        <div
          style={{
            width: "280px",
            background: isDark ? "#1e2937" : "#f8f4ff",
            borderRight: `1px solid ${isDark ? "#334155" : "#c4b5fd"}`,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <button
            onClick={handleNewChat}
            style={{
              margin: "24px 20px",
              padding: "16px",
              background: isDark ? "#22d3ee" : "#8b5cf6",
              color: isDark ? "#0f172a" : "#fff",
              border: "none",
              borderRadius: "14px",
              fontSize: "16px",
              fontWeight: "600",
              cursor: "pointer",
            }}
          >
            + New Chat
          </button>

          <div style={{ flex: 1, overflowY: "auto", padding: "0 12px" }}>
            {chats.map((chat) => (
              <div
                key={chat.id}
                style={{
                  position: "relative",
                  padding: "16px 20px",
                  margin: "6px 8px",
                  borderRadius: "14px",
                  cursor: "pointer",
                  background:
                    chat.id === activeChatId
                      ? isDark
                        ? "#334155"
                        : "#e0d4ff"
                      : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
                onClick={() => setActiveChatId(chat.id)}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: isDark ? "#e0f2fe" : "#4c1d95" }}>
                    {chat.title}
                  </div>
                  <div
                    style={{
                      fontSize: "13.5px",
                      color: isDark ? "#94a3b8" : "#6b7280",
                      marginTop: "6px",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {chat.messages.length
                      ? chat.messages[chat.messages.length - 1].content.slice(0, 45) + "..."
                      : "No messages yet"}
                  </div>
                </div>

                {/* Delete Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteChat(chat.id);
                  }}
                  style={{
                    opacity: 0.7,
                    padding: "6px",
                    borderRadius: "50%",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "18px",
                    color: "#ef4444",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.opacity = "1")}
                  onMouseOut={(e) => (e.currentTarget.style.opacity = "0.7")}
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Main Chat Area - New Colors */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "25px 20px",
            background: isDark ? "#0f172a" : "#f8f4ff",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "640px",
              height: "560px",
              background: isDark ? "#1e2937" : "#ffffff",
              borderRadius: "20px",
              overflow: "hidden",
              boxShadow: "0 10px 35px rgba(0,0,0,0.15)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Chat Header */}
            <div
              style={{
                padding: "15px 26px",
                background: isDark ? "#1e2937" : "#e0d4ff",
                borderBottom: `1px solid ${isDark ? "#334155" : "#c4b5fd"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                minHeight: "66px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ fontSize: "32px" }}>🐱</span>
                <div>
                  <div style={{ 
                    fontSize: "21px", 
                    fontWeight: "600", 
                    color: isDark ? "#67e8f9" : "#4c1d95" 
                  }}>
                    Meow
                  </div>
                  <div style={{ fontSize: "12.5px", opacity: 0.8 }}>AI Assistant</div>
                </div>
              </div>

              {activeChat && (
                <button
                  onClick={clearCurrentChat}
                  style={{
                    padding: "8px 24px",
                    borderRadius: "30px",
                    background: isDark ? "#334155" : "#f3e8ff",
                    border: "none",
                    fontWeight: "600",
                    fontSize: "14px",
                    color: isDark ? "#67e8f9" : "#4c1d95",
                    cursor: "pointer",
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            {/* Messages Area */}
            <div
              style={{
                flex: 1,
                padding: "22px",
                overflowY: "auto",
                background: isDark ? "#1e2937" : "#f8f4ff",
                display: "flex",
                flexDirection: "column",
                gap: "15px",
              }}
            >
              {(!activeChat || activeChat.messages.length === 0) && (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    textAlign: "center",
                    color: isDark ? "#94a3b8" : "#6b7280",
                  }}
                >
                  <div style={{ fontSize: "52px", marginBottom: "16px" }}>👋</div>
                  <h2 style={{ fontSize: "25px" }}>Welcome to Meow</h2>
                  <p style={{ fontSize: "16px", marginTop: "8px" }}>
                    Ask anything and start chatting
                  </p>
                </div>
              )}

              {activeChat?.messages.map((msg) => (
                <Message key={msg.id} {...msg} isDark={isDark} />
              ))}

              {botTyping && <BotTyping />}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div
              style={{
                padding: "16px 26px",
                borderTop: `1px solid ${isDark ? "#334155" : "#c4b5fd"}`,
                background: isDark ? "#1e2937" : "#ffffff",
              }}
            >
              <InputArea
                onSend={handleSend}
                isDark={isDark}
                disabled={loading}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}