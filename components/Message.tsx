"use client";

type MessageProps = {
  text: string;
  sender: "user" | "bot";
  time: string;
};

export default function Message({ text, sender, time }: MessageProps) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: sender === "user" ? "flex-end" : "flex-start",
      }}
    >
      <div
        style={{
          background: sender === "user" ? "#007bff" : "#e5e5ea",
          color: sender === "user" ? "white" : "black",
          padding: "10px",
          borderRadius: "12px",
          maxWidth: "70%",
        }}
      >
        <div>{text}</div>
        <div style={{ fontSize: "10px", marginTop: "5px", textAlign: "right" }}>
          {time}
        </div>
      </div>
    </div>
  );
}