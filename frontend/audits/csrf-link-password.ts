#!/usr/bin/env npx tsx
// CSRF Link Password Audit
import 'dotenv/config';
import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import { readFileSync } from 'fs';

const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY });

const authCode = readFileSync('./src/lib/auth.ts', 'utf-8');

const state = {
  auth_ts: authCode,
  note: 'linkPassword (auth.ts:632-671) POSTs to /api/link-password same-origin with credentials:include. No CSRF token, no Origin check, no SameSite=Strict enforcement visible.',
};

async function run() {
  const result = await client.systemOne({
    state,
    questions: {
      csrf_link_password: noul({
        question: 'Is the /api/link-password endpoint vulnerable to CSRF? Same-origin POST with cookies but no CSRF token, no SameSite=Strict, no Origin/Referer verification.',
        criteria: 'Same-origin POST with cookies but no CSRF token generation/validation, no SameSite=Strict enforcement visible, no Origin/Referer verification. Relies on browser SameSite defaults.',
      }),
    },
  });

  const ans = result.answers?.csrf_link_password;
  const pYes = ans?.noul ?? 0;
  return { name: 'CSRF on Link Password', pYes, severity: pYes > 0.65 ? 'high' : pYes > 0.4 ? 'medium' : 'low', detail: 'Add CSRF token to /api/link-password; enforce SameSite=Strict on auth cookies' };
}

run().then(r => console.log(JSON.stringify(r))).catch(console.error);