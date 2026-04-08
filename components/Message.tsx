"use client";

type Props = {
  content: string;
  role: "user" | "assistant";
  timestamp: string;
};

export default function Message({ content, role, timestamp }: Props) {
  const isUser = role === "user";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
      }}
    >
      <div
        style={{
          background: isUser ? "#007bff" : "#e5e5ea",
          color: isUser ? "white" : "black",
          padding: "10px",
          borderRadius: "15px",
          maxWidth: "70%",
        }}
      >
        <div>{content}</div>
        <div style={{ fontSize: "10px", textAlign: "right" }}>
          {timestamp}
        </div>
      </div>
    </div>
  );
}