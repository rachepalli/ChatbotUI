// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";

const mockResponses = [
  "That's a great question! Let me think about it.",
  "Meow! Interesting point 🐱",
  "I agree with you on that.",
  "Here's what I know about this topic...",
  "Could you tell me more about what you mean?",
  "That's fascinating! Here's my take on it.",
];

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json();

    // Simulate thinking time
    await new Promise((resolve) => setTimeout(resolve, 800));

    const randomReply = mockResponses[Math.floor(Math.random() * mockResponses.length)];

    return NextResponse.json({
      reply: `${randomReply} You said: "${message}"`,
    });
  } catch (error) {
    return NextResponse.json(
      { reply: "Sorry, I couldn't process that request." },
      { status: 500 }
    );
  }
}