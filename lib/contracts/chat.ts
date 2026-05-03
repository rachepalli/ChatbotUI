import type { LLMResponse } from "@/lib/contracts/llm";

export type ThreadContract = {
  chatId: string;
  title: string;
  userId: string;
  pinned: boolean;
  archived: boolean;
};

export type MessageContract = {
  threadId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
};

export type ChatReplyContract = {
  reply: string;
  model: string;
  usage: LLMResponse["usage"];
  error: LLMResponse["error"];
};
