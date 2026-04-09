// components/InputArea.tsx
"use client";

import { useState, KeyboardEvent } from "react";

type InputAreaProps = {
  onSend: (text: string) => void;
  isDark: boolean;
  disabled: boolean;
};

export default function InputArea({ onSend, isDark, disabled }: InputAreaProps) {
  const [input, setInput] = useState("");
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  const handleSend = () => {
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput("");
      setShowAttachMenu(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSend();
    }
  };

  const handleAttach = (type: string) => {
    setShowAttachMenu(false);
    
    // Mock functionality - In real app, you would open file picker here
    if (type === "image") {
      alert("📸 Image upload feature would open here (Camera/Gallery)");
    } else if (type === "document") {
      alert("📄 Document upload feature would open here (PDF, Word, etc.)");
    } else if (type === "camera") {
      alert("📷 Camera access would open here");
    }
  };

  return (
    <div style={{ position: "relative" }}>
      {/* Attach Menu */}
      {showAttachMenu && (
        <div
          style={{
            position: "absolute",
            bottom: "70px",
            left: "20px",
            background: isDark ? "#333" : "#fff",
            borderRadius: "14px",
            boxShadow: "0 6px 20px rgba(0,0,0,0.2)",
            padding: "12px 0",
            zIndex: 100,
            minWidth: "180px",
          }}
        >
          <div
            onClick={() => handleAttach("image")}
            style={{
              padding: "12px 20px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              fontSize: "15px",
            }}
          >
            🖼️ <span>Image / Photo</span>
          </div>
          <div
            onClick={() => handleAttach("document")}
            style={{
              padding: "12px 20px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              fontSize: "15px",
            }}
          >
            📄 <span>Document</span>
          </div>
          <div
            onClick={() => handleAttach("camera")}
            style={{
              padding: "12px 20px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              fontSize: "15px",
            }}
          >
            📷 <span>Camera</span>
          </div>
        </div>
      )}

      {/* Input Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          background: isDark ? "#3a3a3a" : "#f8f8f8",
          padding: "8px 12px",
          borderRadius: "30px",
          border: `1px solid ${isDark ? "#555" : "#ddd"}`,
        }}
      >
        {/* Attach Button (+) */}
        <button
          onClick={() => setShowAttachMenu(!showAttachMenu)}
          style={{
            width: "46px",
            height: "46px",
            borderRadius: "50%",
            background: isDark ? "#555" : "#eee",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "24px",
            cursor: "pointer",
            color: isDark ? "#fff" : "#555",
            flexShrink: 0,
          }}
        >
          +
        </button>

        {/* Text Input */}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message..."
          disabled={disabled}
          style={{
            flex: 1,
            padding: "14px 18px",
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: "16px",
            color: isDark ? "#fff" : "#000",
          }}
        />

        {/* Send Button */}
        <button
          onClick={handleSend}
          disabled={!input.trim() || disabled}
          style={{
            padding: "0 28px",
            height: "46px",
            background: input.trim() && !disabled
              ? "#ffaa00"
              : "#ccc",
            color: "#fff",
            border: "none",
            borderRadius: "30px",
            fontWeight: "600",
            cursor: input.trim() && !disabled ? "pointer" : "not-allowed",
            fontSize: "15px",
            flexShrink: 0,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}