import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { apiClient, ApiError } from "./api-client";

/** Decode JWT exp (seconds) without verifying — we only schedule refreshes. */
function tokenExpiry(jwt: string): number {
  try {
    const payload = JSON.parse(
      Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"),
    ) as { exp?: number };
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

const googleConfigured =
  Boolean(process.env.GOOGLE_CLIENT_ID) && Boolean(process.env.GOOGLE_CLIENT_SECRET);

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) {
          return null;
        }

        try {
          const tokens = await apiClient.login(
            credentials.email,
            credentials.password,
          );
          const profile = await apiClient.me(tokens.accessToken);
          return {
            id: profile.id,
            email: profile.email,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            planTier: profile.plan?.tier ?? "free",
            executionMode: profile.executionMode,
            killSwitchActive: Boolean(profile.riskSettings?.killSwitchActive),
          };
        } catch {
          // Never mint a fake session — failed auth must stay failed.
          return null;
        }
      },
    }),
    ...(googleConfigured
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") return true;
      if (!user.email || !account.id_token) return false;
      try {
        const tokens = await apiClient.googleLogin(account.id_token);
        const profile = await apiClient.me(tokens.accessToken);
        (user as { accessToken?: string }).accessToken = tokens.accessToken;
        (user as { refreshToken?: string }).refreshToken = tokens.refreshToken;
        (user as { planTier?: string }).planTier = profile.plan?.tier ?? "free";
        (user as { executionMode?: string }).executionMode = profile.executionMode;
        (user as { killSwitchActive?: boolean }).killSwitchActive = Boolean(
          profile.riskSettings?.killSwitchActive,
        );
        (user as { id?: string }).id = profile.id;
        return true;
      } catch {
        return false;
      }
    },
    async jwt({ token, user }) {
      if (user) {
        const u = user as {
          accessToken?: string;
          refreshToken?: string;
          planTier?: string;
          executionMode?: string;
          killSwitchActive?: boolean;
        };
        token.accessToken = u.accessToken;
        token.refreshToken = u.refreshToken;
        token.planTier = u.planTier;
        token.executionMode = u.executionMode;
        token.killSwitchActive = u.killSwitchActive;
        return token;
      }

      const accessToken = token.accessToken as string | undefined;
      const refreshToken = token.refreshToken as string | undefined;
      const expiresSoon =
        !accessToken || tokenExpiry(accessToken) - Date.now() < 60_000;

      if (expiresSoon && refreshToken) {
        try {
          const rotated = await apiClient.refresh(refreshToken);
          token.accessToken = rotated.accessToken;
          if (rotated.refreshToken) token.refreshToken = rotated.refreshToken;
        } catch {
          token.accessToken = undefined;
          token.refreshToken = undefined;
          return token;
        }
      }

      if (token.accessToken) {
        try {
          const profile = await apiClient.me(token.accessToken as string);
          token.planTier = profile.plan?.tier ?? "free";
          token.executionMode = profile.executionMode;
          token.killSwitchActive = Boolean(profile.riskSettings?.killSwitchActive);
        } catch {
          // keep last known claims
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.accessToken = token.accessToken as string | undefined;
        session.user.planTier = (token.planTier as string) ?? "free";
        session.user.executionMode = (token.executionMode as string) ?? "manual";
        session.user.killSwitchActive = Boolean(token.killSwitchActive);
      }
      return session;
    },
  },
};
