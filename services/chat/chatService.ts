import type { ChatReplyContract } from "@/lib/contracts/chat";
import { ServiceError } from "@/lib/errors/service-error";
import { ChatRepository } from "@/repositories/chatRepository";
import { generateLLMResponse } from "@/services/llm/client";

function buildAutoTitle(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return "New Chat";
  return normalized.slice(0, 50);
}

export const ChatService = {
  async sendMessage(input: {
    message: string;
    chatId: string;
    userId: string;
    model?: string;
  }): Promise<ChatReplyContract> {
    const { message, chatId, userId, model } = input;
    if (!message || !chatId || !userId) {
      throw new ServiceError("Missing message, chatId or user", 400, "BAD_REQUEST");
    }

    await ChatRepository.upsertThread(chatId, userId, "New Chat");

    await ChatRepository.createMessage({
      threadId: chatId,
      userId,
      role: "user",
      content: message,
    });

    const userMessageCount = await ChatRepository.countUserMessages(chatId, userId);
    if (userMessageCount === 1) {
      await ChatRepository.updateThread(chatId, userId, {
        title: buildAutoTitle(message),
      });
    }

    const llm = await generateLLMResponse({
      message,
      model: model || "gemini-2.5-flash",
      timeoutMs: 10000,
    });

    const assistantReply = llm.error ? "⚠️ AI pipeline failed" : llm.message;

    await ChatRepository.createMessage({
      threadId: chatId,
      userId,
      role: "assistant",
      content: assistantReply,
    });

    return {
      reply: assistantReply,
      model: llm.model,
      usage: llm.usage,
      error: llm.error,
    };
  },
};
