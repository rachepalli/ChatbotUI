// components/Message.tsx
type MessageProps = {
  content: string;
  role: "user" | "assistant";
  timestamp: string;
  isDark: boolean;
};

export default function Message({ content, role, timestamp, isDark }: MessageProps) {
  return (
    <div
      style={{
        alignSelf: role === "user" ? "flex-end" : "flex-start",
        maxWidth: "75%",
        background: role === "user"
          ? isDark
            ? "#ffb347"
            : "#ffdda0"
          : isDark
          ? "#555"
          : "#f0edee",
        color: role === "user" ? (isDark ? "#000" : "#000") : isDark ? "#fff" : "#000",
        padding: "14px 20px",
        borderRadius: "18px",
        boxShadow: "0 3px 10px rgba(0,0,0,0.08)",
        position: "relative",
      }}
    >
      <div style={{ fontSize: "15.5px", lineHeight: "1.5" }}>{content}</div>
      <div
        style={{
          fontSize: "11px",
          opacity: 0.7,
          marginTop: "6px",
          textAlign: role === "user" ? "right" : "left",
        }}
      >
        {timestamp}
      </div>
    </div>
  );
}