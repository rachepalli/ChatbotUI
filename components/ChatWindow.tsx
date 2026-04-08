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

export default function ChatWindow() {
    const [messages, setMessages] = useState<MessageType[]>([]);
    const [loading, setLoading] = useState(false);

    const bottomRef = useRef<HTMLDivElement | null>(null);

    const getTime = () =>
        new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });

    // ✅ Auto-scroll
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, loading]);

    const handleSend = async (text: string) => {
        const userMessage: MessageType = {
            id: Date.now().toString(),
            content: text,
            role: "user",
            timestamp: getTime(),
        };

        // Add user message instantly
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
    maxWidth: "600px",
    width: "100%",
    margin: "auto",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    border: "1px solid #ccc",
    borderRadius: "10px",
    boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
}}
        >
            {/* Header */}
            <div
                style={{
    padding: "14px",
    background: "#007bff",
    color: "white",
    fontWeight: "bold",
    fontSize: "18px",
    textAlign: "center",
    borderTopLeftRadius: "10px",
    borderTopRightRadius: "10px",
}}
            >
                ChatBot 🤖
            </div>

            {/* Messages */}
            <div
                style={{
    flex: 1,
    overflowY: "auto",
    padding: "15px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    background: "#f9f9f9",
}}
            >
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

                <div ref={bottomRef} />
            </div>

            {/* Input */}
            <InputArea onSend={handleSend} />
        </div>
    );
}