// TEMP local seed helper (delete after use): signs in the e2e seed user via a
// minimal BetterAuth server instance (same secret + same Neon DB) and dumps
// the exact Set-Cookie headers (signed session cookies) for Playwright.
// Inline schema (avoids importing root .ts files, which load as CJS).
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  pgTable,
  text,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";
import * as fs from "node:fs";

const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull(),
});
const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
const schema = { user, session, account, verification };

const env: Record<string, string> = {};
for (const line of fs.readFileSync("./.env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !env[m[1]]) env[m[1]] = m[2].trim();
}

const pool = new Pool({ connectionString: env.DATABASE_URL });
const db = drizzle(pool, { schema });
const auth = betterAuth({
  baseURL: "http://localhost:4323",
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true },
  trustedOrigins: ["http://localhost:4323", "http://localhost:4321"],
});

const email = "e2e.sectiona@example.com";
const password = "E2e-SectionA-9x7q!Test";

const res = (await auth.api.signInEmail({
  body: { email, password },
  headers: new Headers({ origin: "http://localhost:4323" }),
  asResponse: true,
})) as Response;
const bodyText = await res.text();
console.log("STATUS", res.status);
console.log("BODY", bodyText.slice(0, 300));
const cookies =
  typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie")].filter(Boolean);
console.log("COOKIES", JSON.stringify(cookies, null, 1));
fs.writeFileSync(
  "C:\\Users\\anubh\\AppData\\Local\\Temp\\opencode\\seed-cookies.json",
  JSON.stringify(cookies, null, 1),
);
await pool.end().catch(() => {});
if (res.status !== 200) process.exitCode = 1;
