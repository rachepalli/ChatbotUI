import mongoose from "mongoose";

const ThreadSchema = new mongoose.Schema(
  {
    chatId: { type: String, required: true },
    title: { type: String, default: "New Chat" },

    // ✅ THIS IS CRITICAL (user ownership)
    userId: { type: String, required: true },

    pinned: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.models.Thread ||
  mongoose.model("Thread", ThreadSchema);