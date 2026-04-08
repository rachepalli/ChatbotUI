"use client";
import { useState } from "react";

type InputProps = {
  onSend: (message: string) => void;
};

export default function InputArea({ onSend }: InputProps) {
  const [input, setInput] = useState("");

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input);
    setInput("");
  };

  return (
    <div
      style={{
        display: "flex",
        padding: "10px",
        borderTop: "1px solid #ccc",
        gap: "10px",
      }}
    >
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
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSend();
        }}
      />

      <button
        onClick={handleSend}
        disabled={!input.trim()}
        style={{
          padding: "10px 15px",
          borderRadius: "8px",
          background: input.trim() ? "#007bff" : "#aaa",
          color: "white",
          border: "none",
          cursor: input.trim() ? "pointer" : "not-allowed",
        }}
      >
        Send
      </button>
    </div>
  );
}