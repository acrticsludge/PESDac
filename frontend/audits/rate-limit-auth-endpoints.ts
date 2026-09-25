#!/usr/bin/env npx tsx
// Rate Limit Auth Endpoints Audit
import 'dotenv/config';
import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import { readFileSync } from 'fs';

const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY });

const authCode = readFileSync('./src/lib/auth.ts', 'utf-8');

const state = {
  auth_ts: authCode,
  note: 'signIn/signUp/signInWithGoogle/linkPassword/changePassword (auth.ts:310-341, 362-345, 499-514, 632-671, 545-558) call authClient directly with no throttling, debouncing, or retry logic.',
};

async function run() {
  const result = await client.systemOne({
    state,
    questions: {
      rate_limit_auth_endpoints: noul({
        question: 'Are signIn, signUp, changePassword, linkPassword rate limited client-side? Functions call authClient directly with no throttling, debouncing, or retry logic.',
        criteria: 'signIn/signUp/signInWithGoogle/linkPassword/changePassword call authClient directly. No client-side rate limiting, no exponential backoff, no request deduplication for auth endpoints.',
      }),
    },
  });

  const ans = result.answers?.rate_limit_auth_endpoints;
  const pYes = ans?.noul ?? 0;
  return { name: 'Missing Rate Limit on Auth Endpoints', pYes, severity: pYes > 0.65 ? 'high' : pYes > 0.4 ? 'medium' : 'low', detail: 'Add client-side throttling/debouncing to signIn, signUp, changePassword, linkPassword' };
}

run().then(r => console.log(JSON.stringify(r))).catch(console.error);