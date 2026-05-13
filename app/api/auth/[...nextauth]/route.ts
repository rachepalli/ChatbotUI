import NextAuth, { type AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";

type SessionUserWithId = NonNullable<AuthOptions["callbacks"]> extends {
  session?: (...args: infer Args) => unknown;
}
  ? Args[0] extends { session: infer Session }
    ? Session extends { user?: infer User }
      ? User & { id?: string }
      : { id?: string }
    : { id?: string }
  : { id?: string };

export const authOptions: AuthOptions = {
  providers: [
    // ✅ GOOGLE
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),

    // ✅ GITHUB
    GitHubProvider({
      clientId: process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
    }),

    // ✅ CREDENTIALS LOGIN
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },

      async authorize(credentials) {
        await connectToDatabase();
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;

        if (!email || !password) {
          throw new Error("Email and password are required");
        }

        const user = await User.findOne({
          email,
        });

        if (!user) throw new Error("No user found");
        if (!user.password) throw new Error("Password login unavailable");

        // ✅ PASSWORD CHECK
        const isValid = await bcrypt.compare(password, user.password);

        if (!isValid) throw new Error("Wrong password");

        return {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.name = user.name;
        token.email = user.email;
      }

      if (trigger === "update" && session?.user) {
        if (typeof session.user.name === "string") token.name = session.user.name;
        if (typeof session.user.email === "string") token.email = session.user.email;
      }

      return token;
    },

    async signIn({ user, account }) {
      await connectToDatabase();

      if (!user.email) return false;

      const dbUser = await User.findOne({ email: user.email });

      if (!dbUser) {
        await User.create({
          name: user.name || "User",
          email: user.email,
          image: user.image || "",
          providers: [account?.provider || "credentials"],
        });
      }

      return true;
    },

    async session({ session, token }) {
      await connectToDatabase();

      if (session.user) {
        if (typeof token.name === "string") session.user.name = token.name;
        if (typeof token.email === "string") session.user.email = token.email;
      }

      if (!session.user?.email) return session;

      const dbUser = await User.findOne({
        email: session.user.email,
      });

      if (dbUser) {
        (session.user as SessionUserWithId).id = dbUser._id.toString();
      }

      return session;
    },
  },

  pages: {
    signIn: "/login",
  },

  session: {
    strategy: "jwt",
  },

  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
