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

export default function ChatWindow({ dark }: { dark?: boolean }) {
    const [messages, setMessages] = useState<MessageType[]>([]);
    const [loading, setLoading] = useState(false);

    const bottomRef = useRef<HTMLDivElement | null>(null);

    const getTime = () =>
        new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });

    // 🔊 Sound
    const playSound = () => {
        const audio = new Audio("/notify.mp3");
        audio.play();
    };

    // ✅ Auto-scroll
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [messages, loading]);

    const handleSend = async (text: string) => {
        const userMessage: MessageType = {
            id: Date.now().toString(),
            content: text,
            role: "user",
            timestamp: getTime(),
        };

        setMessages((prev) => [...prev, userMessage]);
        setLoading(true);

        try {
            const res = await fetch("/api/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ message: text }),
            });

            const data = await res.json();

            const botMessage: MessageType = {
                id: (Date.now() + 1).toString(),
                content: data.reply,
                role: "assistant",
                timestamp: getTime(),
            };

            setMessages((prev) => [...prev, botMessage]);
            playSound();
        } catch (error) {
            const errorMessage: MessageType = {
                id: (Date.now() + 2).toString(),
                content: "Something went wrong ❌",
                role: "assistant",
                timestamp: getTime(),
            };

            setMessages((prev) => [...prev, errorMessage]);
        }

        setLoading(false);
    };

    return (
        <div
            style={{
                width: "100%",
                minHeight: "100vh",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: messages.length === 0 ? "center" : "flex-start",
                background: dark ? "#1e1e1e" : "#f9f9f9",
            }}
        >
            {/* 🔥 Small Center Container */}
            <div
                style={{
                    width: "100%",
                    maxWidth: "700px",
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                {/* ✅ Header (only after messages) */}
                {messages.length > 0 && (
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            padding: "12px",
                            background: dark ? "#2a2a2a" : "#ffffff",
                            borderBottom: "1px solid #ccc",
                        }}
                    >
                        <span>ChatBot 🤖</span>

                        <button
                            onClick={() => setMessages([])}
                            style={{
                                padding: "5px 10px",
                                cursor: "pointer",
                            }}
                        >
                            Clear
                        </button>
                    </div>
                )}

                {/* Messages */}
                <div
                    style={{
                        flex: 1,
                        overflowY: "auto",
                        padding: "15px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                        background: dark ? "#2a2a2a" : "#f9f9f9",
                    }}
                >
                    {messages.length === 0 ? (
                        // ✅ Welcome Screen
                        <div
                            style={{
                                flex: 1,
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "center",
                                alignItems: "center",
                                textAlign: "center",
                                gap: "15px",
                            }}
                        >
                            <h2 style={{ fontSize: "28px" }}>Welcome 👋</h2>
                            <p style={{ color: "gray" }}>
                                Ask anything and start chatting
                            </p>
                        </div>
                    ) : (
                        <>
                            {messages.map((msg) => (
                                <Message key={msg.id} {...msg} />
                            ))}

                            {/* Typing Indicator */}
                            {loading && (
                                <div style={{ display: "flex", gap: "4px", padding: "5px" }}>
                                    <span className="dot"></span>
                                    <span className="dot"></span>
                                    <span className="dot"></span>
                                </div>
                            )}
                        </>
                    )}

                    <div ref={bottomRef} />
                </div>

                {/* Input */}
                <div
                    style={{
                        padding: "10px",
                        borderTop: messages.length > 0 ? "1px solid #ccc" : "none",
                    }}
                >
                    <InputArea onSend={handleSend} dark={dark} disabled={loading} />        </div>
            </div>
        </div>
    );
}