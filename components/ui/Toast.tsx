"use client";

type ToastProps = {
  message: string;
  type: "success" | "error";
};

export default function Toast({ message, type }: ToastProps) {
  const tone =
    type === "success"
      ? "border-green-500/40 bg-green-500/10 text-green-200"
      : "border-red-500/40 bg-red-500/10 text-red-200";

  return (
    <div
      className={`fixed right-4 top-4 z-50 max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur ${tone}`}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
