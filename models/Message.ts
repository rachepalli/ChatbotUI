import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema(
  {
    threadId: String,
    userId: String,
    role: String,
    content: String,
  },
  { timestamps: true }
);

export default mongoose.models.Message ||
  mongoose.model("Message", MessageSchema);