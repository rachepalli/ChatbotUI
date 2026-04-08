"use client";
import { useState } from "react";

type Props = {
  onSend: (text: string) => void;
  disabled?: boolean;
  dark?: boolean;
};

export default function InputArea({ onSend, disabled, dark }: Props) {
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
        border: "1px solid #ccc",
        borderRadius: "25px",
        background: dark ? "#2a2a2a" : "#fff",
      }}
    >
      <input
        disabled={disabled}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Type a message..."
        style={{
          flex: 1,
          border: "none",
          outline: "none",
          padding: "10px",
          background: "transparent",
          color: "inherit",
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSend();
        }}
      />

      <button
      
        onClick={handleSend}
        disabled={!input.trim()}
        style={{
          border: "none",
          background: "#007bff",
          color: "white",
          borderRadius: "20px",
          padding: "8px 12px",
          cursor: "pointer",
        }}
      >
        Send
      </button>
    </div>
  );
}