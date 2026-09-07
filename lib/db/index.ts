import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Astro 6 dev SSR exposes .env through import.meta.env (Vite loadEnv),
// not process.env — prefer process.env so plain-node runtimes (drizzle
// scripts) keep working with zero changes.
const DATABASE_URL =
  process.env.DATABASE_URL ??
  (import.meta.env as Record<string, string | undefined>).DATABASE_URL;

const pool = new Pool({
  connectionString: DATABASE_URL!,
});

export const db = drizzle(pool, { schema });