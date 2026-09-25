#!/usr/bin/env npx tsx
// Rate Limit Token Mint Audit
import 'dotenv/config';
import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import { readFileSync } from 'fs';

const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY });

const authCacheCode = readFileSync('./src/lib/auth-cache.ts', 'utf-8');

const state = {
  auth_cache_ts: authCacheCode,
  note: 'mintTokenWithRetry (auth-cache.ts:135-153) retries once on 429/5xx after 200ms. No proactive rate limiting, no token bucket, no per-session/IP counters.',
};

async function run() {
  const result = await client.systemOne({
    state,
    questions: {
      rate_limit_token_mint: noul({
        question: 'Is client-side rate limiting implemented for /api/auth/token calls before mintTokenOnce is invoked?',
        criteria: 'Only one retry with fixed 200ms backoff. No proactive rate limiting, no request queuing, no per-session/IP counters. Relies entirely on server-side rate limiting.',
      }),
    },
  });

  const ans = result.answers?.rate_limit_token_mint;
  const pYes = ans?.noul ?? 0;
  return { name: 'Missing Rate Limit on Token Mint', pYes, severity: pYes > 0.65 ? 'high' : pYes > 0.4 ? 'medium' : 'low', detail: 'Add client-side token bucket (per-session + per-IP) before calling /api/auth/token' };
}

run().then(r => console.log(JSON.stringify(r))).catch(console.error);