import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";

export const auth = betterAuth({
  appName: "PESDac",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:4321",
  secret: process.env.BETTER_AUTH_SECRET!,
  
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: "user",
      session: "session",
      account: "account",
      verification: "verification",
      twoFactor: "two_factor",
      passkey: "passkey",
    },
  }),
  
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectURI: `${process.env.BETTER_AUTH_URL}/api/auth/callback/google`,
    },
  },
  
  plugins: [
    twoFactor({ issuer: "PESDac" }),
  ],

  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
  },
  
  advanced: {
    crossSubDomainCookies: {
      enabled: false,
    },
  },
});