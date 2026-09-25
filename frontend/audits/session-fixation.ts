#!/usr/bin/env npx tsx
// Session Fixation Audit
import 'dotenv/config';
import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import { readFileSync } from 'fs';

const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY });

const authCode = readFileSync('./src/lib/auth.ts', 'utf-8');

const state = {
  auth_ts: authCode,
  note: 'BetterAuth session cookie is httpOnly (auth.ts:196). Epoch-based validation (authEpoch) used, not session ID acceptance from input. auth.ts:196-199.',
};

async function run() {
  const result = await client.systemOne({
    state,
    questions: {
      session_fixation: noul({
        question: 'Can an attacker fixate a session ID that the app will accept after login? BetterAuth uses httpOnly cookies; epoch-based validation used, not session ID from input.',
        criteria: 'Session fixation requires attacker to set victim session ID. BetterAuth uses httpOnly cookies (not accessible via JS). auth.ts:196-199 notes epoch-based validation, not session ID acceptance from input.',
      }),
    },
  });

  const ans = result.answers?.session_fixation;
  const pYes = ans?.noul ?? 0;
  return { name: 'Session Fixation', pYes, severity: pYes > 0.65 ? 'high' : pYes > 0.4 ? 'medium' : 'low', detail: 'Ensure session ID regenerated on privilege change; verify httpOnly + Secure flags on cookies' };
}

run().then(r => console.log(JSON.stringify(r))).catch(console.error);