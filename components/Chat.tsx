"use client";
import { useState } from "react";

type Message = {
  text: string;
  sender: "user" | "bot";
};

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");

  const sendMessage = () => {
    if (!input.trim()) return;

    const userMsg: Message = { text: input, sender: "user" };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    // fake bot reply
    setTimeout(() => {
      const botMsg: Message = {
        text: "Hello! You said: " + userMsg.text,
        sender: "bot",
      };
      setMessages((prev) => [...prev, botMsg]);
    }, 1000);
  };

  return (
    <div style={{ maxWidth: "600px", margin: "20px auto" }}>
      <h2 style={{ textAlign: "center" }}>Chat 💬</h2>

      {/* Chat Box */}
      <div
        style={{
          border: "1px solid #ccc",
          borderRadius: "10px",
          padding: "10px",
          height: "400px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.sender === "user" ? "flex-end" : "flex-start",
              background: msg.sender === "user" ? "#007bff" : "#eee",
              color: msg.sender === "user" ? "white" : "black",
              padding: "8px 12px",
              borderRadius: "15px",
              maxWidth: "70%",
            }}
          >
            {msg.text}
          </div>
        ))}
      </div>

      {/* Input */}
      <div style={{ display: "flex", marginTop: "10px", gap: "10px" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: "8px",
            border: "1px solid #ccc",
          }}
        />
        <button
          onClick={sendMessage}
          style={{
            padding: "10px 15px",
            borderRadius: "8px",
            background: "#007bff",
            color: "white",
            border: "none",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}