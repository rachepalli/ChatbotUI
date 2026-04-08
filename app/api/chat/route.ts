import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = await req.json();
  const userMessage = body.message;

  // simulate delay
  await new Promise((res) => setTimeout(res, 1500));

  const responses = [
    "Hello! How can I help you?",
    "That's interesting 🤔",
    "Tell me more!",
    "I understand 👍",
    "You said: " + userMessage,
  ];

  const reply =
    responses[Math.floor(Math.random() * responses.length)];

  return NextResponse.json({ reply });
}