import bcrypt from "bcryptjs";
import { ServiceError } from "@/lib/errors/service-error";
import { UserRepository } from "@/repositories/userRepository";

export const AuthService = {
  async signup(input: { name?: string; email?: string; password?: string }) {
    const normalizedEmail = input.email?.toLowerCase();
    if (!normalizedEmail || !input.password) {
      throw new ServiceError("Email and password required", 400, "BAD_REQUEST");
    }

    const existing = await UserRepository.findByEmail(normalizedEmail);
    if (existing) {
      throw new ServiceError("User already exists", 400, "USER_EXISTS");
    }

    const hash = await bcrypt.hash(input.password, 10);
    await UserRepository.create({
      name: input.name || "User",
      email: normalizedEmail,
      password: hash,
      providers: ["credentials"],
      hasOnboarded: false,
    });
  },
};
