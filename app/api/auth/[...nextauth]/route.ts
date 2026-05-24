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

function logAuthDatabaseIssue(context: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`${context}: ${message}`);
}

const configuredOauthHttpTimeoutMs = Number(process.env.OAUTH_HTTP_TIMEOUT_MS);
const oauthHttpTimeoutMs =
  Number.isFinite(configuredOauthHttpTimeoutMs) && configuredOauthHttpTimeoutMs > 0
    ? configuredOauthHttpTimeoutMs
    : 10000;

export const authOptions: AuthOptions = {
  debug: process.env.NEXTAUTH_DEBUG === "true",
  providers: [
    // ✅ GOOGLE
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      httpOptions: {
        timeout: oauthHttpTimeoutMs,
      },
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
        token.sub = user.id || token.sub;
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
      const email = user.email?.trim().toLowerCase();
      if (!email) return false;
      user.email = email;

      try {
        await connectToDatabase();

        const dbUser = await User.findOne({ email });

        if (!dbUser) {
          const createdUser = await User.create({
            name: user.name || "User",
            email,
            image: user.image || "",
            providers: [account?.provider || "credentials"],
          });
          user.id = createdUser._id.toString();
        } else if (account?.provider && !dbUser.providers?.includes(account.provider)) {
          dbUser.providers = Array.from(new Set([...(dbUser.providers || []), account.provider]));
          await dbUser.save();
          user.id = dbUser._id.toString();
        } else if (dbUser) {
          user.id = dbUser._id.toString();
        }
      } catch (error) {
        logAuthDatabaseIssue("NextAuth sign-in database sync failed", error);
        return account?.provider !== "credentials";
      }

      return true;
    },

    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;

      try {
        const target = new URL(url);
        const base = new URL(baseUrl);
        const isLocalhost =
          ["localhost", "127.0.0.1"].includes(target.hostname) &&
          ["localhost", "127.0.0.1"].includes(base.hostname) &&
          target.port === base.port;

        if (target.origin === base.origin || isLocalhost) return url;
      } catch {
        return baseUrl;
      }

      return baseUrl;
    },

    async session({ session, token }) {
      if (session.user) {
        if (typeof token.name === "string") session.user.name = token.name;
        if (typeof token.email === "string") session.user.email = token.email;
        if (typeof token.sub === "string") (session.user as SessionUserWithId).id = token.sub;
      }

      if (!session.user?.email) return session;

      try {
        await connectToDatabase();

        const dbUser = await User.findOne({
          email: session.user.email,
        });

        if (dbUser) {
          (session.user as SessionUserWithId).id = dbUser._id.toString();
        }
      } catch (error) {
        logAuthDatabaseIssue("NextAuth session database lookup failed", error);
      }

      return session;
    },
  },

  logger: {
    error(code, metadata) {
      console.error("NextAuth error", code, metadata);
    },
    warn(code) {
      console.warn("NextAuth warning", code);
    },
    debug(code, metadata) {
      if (process.env.NEXTAUTH_DEBUG === "true") {
        console.debug("NextAuth debug", code, metadata);
      }
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
