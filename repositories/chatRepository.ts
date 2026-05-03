import { connectToDatabase } from "@/lib/mongodb";
import Message from "@/models/Message";
import Thread from "@/models/Thread";

export const ChatRepository = {
  async findThread(chatId: string, userId: string) {
    await connectToDatabase();
    return Thread.findOne({ chatId, userId });
  },

  async createThread(chatId: string, userId: string, title = "New Chat") {
    await connectToDatabase();
    return Thread.create({ chatId, userId, title });
  },

  async upsertThread(chatId: string, userId: string, title = "New Chat") {
    await connectToDatabase();
    let thread = await Thread.findOne({ chatId, userId });
    if (!thread) {
      thread = await Thread.create({ chatId, userId, title });
    }
    return thread;
  },

  async updateThread(
    chatId: string,
    userId: string,
    payload: { title?: string; pinned?: boolean; archived?: boolean }
  ) {
    await connectToDatabase();
    return Thread.findOneAndUpdate(
      { chatId, userId },
      {
        ...(payload.title !== undefined && { title: payload.title }),
        ...(payload.pinned !== undefined && { pinned: payload.pinned }),
        ...(payload.archived !== undefined && { archived: payload.archived }),
      },
      { returnDocument: "after" }
    );
  },

  async listThreads(userId: string) {
    await connectToDatabase();
    return Thread.find({ userId }).sort({ updatedAt: -1 });
  },

  async deleteThread(chatId: string, userId: string) {
    await connectToDatabase();
    return Thread.deleteOne({ chatId, userId });
  },

  async createMessage(input: {
    threadId: string;
    userId: string;
    role: "user" | "assistant";
    content: string;
  }) {
    await connectToDatabase();
    return Message.create(input);
  },

  async listMessages(threadId: string, userId: string) {
    await connectToDatabase();
    return Message.find({ threadId, userId }).sort({ createdAt: 1 });
  },

  async countUserMessages(threadId: string, userId: string) {
    await connectToDatabase();
    return Message.countDocuments({ threadId, userId, role: "user" });
  },
};
