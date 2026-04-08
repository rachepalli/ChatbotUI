"use client";
import { useState } from "react";
import ChatWindow from "../components/ChatWindow";

export default function Home() {
  const [dark, setDark] = useState(false);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: dark ? "#1e1e1e" : "#ffffff",
        color: dark ? "white" : "black",
      }}
    >
      {/* ✅ Navbar */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1000,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "14px 24px",
          backdropFilter: "blur(10px)",
          background: dark
            ? "rgba(30,30,30,0.8)"
            : "rgba(255,255,255,0.8)",
          borderBottom: "1px solid rgba(200,200,200,0.3)",
        }}
      >
        {/* Logo / Title */}
        <h2 style={{ margin: 0, fontWeight: "600" }}>
          Meow Chatbot 🐱
        </h2>

        {/* Toggle Button */}
        <button
          onClick={() => setDark(!dark)}
          style={{
            padding: "6px 14px",
            borderRadius: "20px",
            border: "none",
            cursor: "pointer",
            fontSize: "14px",
            background: dark ? "#333" : "#eee",
            color: dark ? "white" : "black",
            transition: "0.3s",
          }}
        >
          {dark ? "☀️ Light" : "🌙 Dark"}
        </button>
      </div>

      {/* ✅ Chat */}
      <ChatWindow dark={dark} />
    </div>
  );
}