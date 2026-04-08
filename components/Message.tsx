"use client";
import ReactMarkdown from "react-markdown";
import { FiCopy } from "react-icons/fi";
type Props = {
    content: string;
    role: "user" | "assistant";
    timestamp: string;
};

export default function Message({ content, role, timestamp }: Props) {
    const isUser = role === "user";

    return (
        <div
            className="fade"
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
                <ReactMarkdown>{content}</ReactMarkdown>

                {/* Copy Button */}
                <button
                    onClick={() => navigator.clipboard.writeText(content)}
                    style={{
                        marginTop: "5px",
                        cursor: "pointer",
                        background: "transparent",
                        border: "none",
                        color: isUser ? "white" : "black",
                    }}
                >
                    <FiCopy size={14} />
                </button>

                {/* Timestamp */}
                <div
                    style={{
                        fontSize: "10px",
                        textAlign: "right",
                        marginTop: "5px",
                    }}
                >
                    {timestamp}
                </div>
            </div>
        </div>
    );
}