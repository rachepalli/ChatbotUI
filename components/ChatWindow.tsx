"use client";
import { useState } from "react";
import Message from "./Message";
import InputArea from "./InputArea";

type Msg = {
  text: string;
  sender: "user" | "bot";
  time: string;
};

export default function ChatWindow() {
  const [messages, setMessages] = useState<Msg[]>([]);

  const getTime = () => {
    return new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleSend = (text: string) => {
    const userMsg: Msg = {
      text,
      sender: "user",
      time: getTime(),
    };

    setMessages((prev) => [...prev, userMsg]);

    // fake bot reply
    setTimeout(() => {
      const botMsg: Msg = {
        text: "Bot reply to: " + text,
        sender: "bot",
        time: getTime(),
      };
      setMessages((prev) => [...prev, botMsg]);
    }, 1000);
  };

  return (
    <div
      style={{
        maxWidth: "600px",
        margin: "20px auto",
        border: "1px solid #ccc",
        borderRadius: "10px",
        display: "flex",
        flexDirection: "column",
        height: "500px",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "10px",
          background: "#007bff",
          color: "white",
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
          padding: "10px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        {messages.map((msg, i) => (
          <Message key={i} {...msg} />
        ))}
      </div>

      {/* Input */}
      <InputArea onSend={handleSend} />
    </div>
  );
}