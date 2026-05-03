import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";

export const UserRepository = {
  async findByEmail(email: string) {
    await connectToDatabase();
    return User.findOne({ email });
  },

  async create(input: {
    name: string;
    email: string;
    password?: string;
    providers?: string[];
    image?: string;
    hasOnboarded?: boolean;
  }) {
    await connectToDatabase();
    return User.create(input);
  },

  async markOnboarded(email: string) {
    await connectToDatabase();
    return User.findOneAndUpdate({ email }, { hasOnboarded: true });
  },
};
