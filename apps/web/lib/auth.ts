import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { apiClient } from "./api-client";

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

const DAY = 24 * 60 * 60;
const SESSION_MAX_AGE_REMEMBER = 30 * DAY;
const SESSION_MAX_AGE_SHORT = 1 * DAY;

export const authOptions: NextAuthOptions = {
  // Upper bound; actual lifetime follows rememberMe via token + API refresh.
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_REMEMBER },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        rememberMe: { label: "Remember me", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) {
          return null;
        }

        const rememberMe = credentials.rememberMe === "true";
        try {
          // Single round-trip: tokens + profile (no follow-up /users/me).
          const result = await apiClient.login(
            credentials.email,
            credentials.password,
            rememberMe,
          );
          const profile = result.user;
          return {
            id: profile.id,
            email: profile.email,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            planTier: profile.planTier ?? "free",
            executionMode: profile.executionMode,
            killSwitchActive: Boolean(profile.killSwitchActive),
            rememberMe,
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
        const tokens = await apiClient.googleLogin(account.id_token, true);
        const profile = tokens.user;
        (user as { accessToken?: string }).accessToken = tokens.accessToken;
        (user as { refreshToken?: string }).refreshToken = tokens.refreshToken;
        (user as { planTier?: string }).planTier = profile.planTier ?? "free";
        (user as { executionMode?: string }).executionMode = profile.executionMode;
        (user as { killSwitchActive?: boolean }).killSwitchActive = Boolean(
          profile.killSwitchActive,
        );
        (user as { id?: string }).id = profile.id;
        (user as { rememberMe?: boolean }).rememberMe = true;
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
          rememberMe?: boolean;
        };
        token.accessToken = u.accessToken;
        token.refreshToken = u.refreshToken;
        token.planTier = u.planTier;
        token.executionMode = u.executionMode;
        token.killSwitchActive = u.killSwitchActive;
        token.rememberMe = Boolean(u.rememberMe);
        // Bound NextAuth JWT cookie lifetime to remember preference.
        token.maxAge = u.rememberMe
          ? SESSION_MAX_AGE_REMEMBER
          : SESSION_MAX_AGE_SHORT;
        return token;
      }

      const accessToken = token.accessToken as string | undefined;
      const refreshToken = token.refreshToken as string | undefined;
      const expiresSoon =
        !accessToken || tokenExpiry(accessToken) - Date.now() < 60_000;

      if (expiresSoon && refreshToken) {
        try {
          // Hard-cap refresh so getServerSession never hangs navigations.
          const rotated = await apiClient.refresh(refreshToken);
          token.accessToken = rotated.accessToken;
          if (rotated.refreshToken) token.refreshToken = rotated.refreshToken;
          if (rotated.user) {
            token.planTier = rotated.user.planTier;
            token.executionMode = rotated.user.executionMode;
            token.killSwitchActive = rotated.user.killSwitchActive;
          }
        } catch {
          // Keep existing access token if still valid; only clear when expired.
          if (!accessToken || tokenExpiry(accessToken) <= Date.now()) {
            token.accessToken = undefined;
            token.refreshToken = undefined;
          }
          return token;
        }
      }

      // Do NOT call /users/me on every JWT tick — that doubled DB load and
      // made sessions feel slow / flaky when the pool was busy.
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
