import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";

type ProfilePatch = {
  name?: unknown;
  email?: unknown;
};

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as ProfilePatch;
  const updates: { name?: string; email?: string } = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (name.length < 2) {
      return Response.json({ error: "Name must be at least 2 characters." }, { status: 400 });
    }
    updates.name = name;
  }

  if (typeof body.email === "string") {
    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    updates.email = email;
  }

  if (!updates.name && !updates.email) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  await connectToDatabase();

  if (updates.email && updates.email !== session.user.email) {
    const existing = await User.findOne({ email: updates.email });
    if (existing) {
      return Response.json({ error: "That email is already in use." }, { status: 409 });
    }
  }

  const user = await User.findOneAndUpdate({ email: session.user.email }, updates, {
    new: true,
    runValidators: true,
  });

  if (!user) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }

  if (updates.email && updates.email !== session.user.email) {
    await Promise.all([
      mongoose.connection.db?.collection("threads").updateMany({ userId: session.user.email }, { $set: { userId: updates.email } }),
      mongoose.connection.db?.collection("messages").updateMany({ userId: session.user.email }, { $set: { userId: updates.email } }),
      mongoose.connection.db?.collection("rag_chunks").updateMany({ userId: session.user.email }, { $set: { userId: updates.email } }),
    ]);
  }

  return Response.json({
    user: {
      email: user.email,
      name: user.name,
    },
  });
}
