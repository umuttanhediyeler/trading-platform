import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    user: {
      id: string;
      planTier?: string;
      executionMode?: string;
      killSwitchActive?: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    accessToken?: string;
    refreshToken?: string;
    planTier?: string;
    executionMode?: string;
    killSwitchActive?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    planTier?: string;
    executionMode?: string;
    killSwitchActive?: boolean;
  }
}
