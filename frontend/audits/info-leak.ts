#!/usr/bin/env npx tsx
// Info Leak in Auth Errors Audit
import 'dotenv/config';
import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import { readFileSync } from 'fs';

const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY });

const authCode = readFileSync('./src/lib/auth.ts', 'utf-8');

const state = {
  auth_ts: authCode,
  note: 'apiFetch (auth.ts:1186-1196) and linkPassword (auth.ts:650-668) use toUserMessage from api/errors.ts. ApiError wraps backend envelope. BetterAuth typically normalizes errors.',
};

async function run() {
  const result = await client.systemOne({
    state,
    questions: {
      info_leak_auth_errors: noul({
        question: 'Do auth error responses distinguish between "user not found", "wrong password", "invalid token" in user-visible messages? toUserMessage normalizes; ApiError wraps backend envelope.',
        criteria: 'Distinguishable errors for "user not found" vs "wrong password" vs "invalid token" in responses. BetterAuth typically normalizes to generic "Invalid credentials".',
      }),
    },
  });

  const ans = result.answers?.info_leak_auth_errors;
  const pYes = ans?.noul ?? 0;
  return { name: 'Information Leak in Auth Errors', pYes, severity: pYes > 0.65 ? 'high' : pYes > 0.4 ? 'medium' : 'low', detail: 'Ensure all auth errors return identical generic messages; audit toUserMessage implementation' };
}

run().then(r => console.log(JSON.stringify(r))).catch(console.error);