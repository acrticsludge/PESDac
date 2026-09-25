#!/usr/bin/env npx tsx
// Verify key findings with focused questions
import 'dotenv/config';
import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import { readFileSync } from 'fs';

const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY });

const authCode = readFileSync('./src/lib/auth.ts', 'utf-8');
const authCacheCode = readFileSync('./src/lib/auth-cache.ts', 'utf-8');

async function verify(key: string, question: string, criteria: string) {
  const result = await client.systemOne({
    state: { auth_ts: authCode, auth_cache_ts: authCacheCode },
    questions: { [key]: noul({ question, criteria }) },
  });
  const ans = result.answers?.[key];
  return { key, pYes: ans?.noul ?? 0 };
}

async function run() {
  const checks = [
    {
      key: 'token_replay',
      question: 'Can backend JWT tokens (from /api/auth/token, called by mintTokenOnce in auth-cache.ts:92) be replayed within their 5-minute client-side cache window (TOKEN_TTL_MS=300000 in auth.ts:1043)? Tokens have no nonce, jti, or replay detection visible in client code.',
      criteria: 'Token cached in memory for 5min. Server issues JWTs (15min per auth.ts:1030 comment). No jti/nonce in payload visible. No server-side replay detection in client code. Replay possible within TTL.',
    },
    {
      key: 'rate_limit_token_mint',
      question: 'Is client-side rate limiting implemented for /api/auth/token calls? mintTokenWithRetry (auth-cache.ts:135-153) retries once on 429/5xx after 200ms backoff. No token bucket, leaky bucket, or per-user/IP throttling in client.',
      criteria: 'Only one retry with fixed 200ms backoff. No proactive rate limiting, no request queuing, no per-session/IP counters. Relies entirely on server-side rate limiting.',
    },
    {
      key: 'csrf_link_password',
      question: 'Is the /api/link-password endpoint (auth.ts:632-671) vulnerable to CSRF? It POSTs same-origin with credentials:include, no CSRF token, no Origin header check, no SameSite=Strict enforcement visible.',
      criteria: 'Same-origin POST with cookies but no CSRF token generation/validation, no SameSite=Strict enforcement visible, no Origin/Referer verification. Relies on browser SameSite defaults.',
    },
    {
      key: 'rate_limit_auth_endpoints',
      question: 'Are signIn, signUp, changePassword, linkPassword rate limited client-side? auth.ts functions call authClient methods directly with no throttling, debouncing, or retry logic.',
      criteria: 'signIn/signUp/signInWithGoogle/linkPassword/changePassword call authClient directly. No client-side rate limiting, no exponential backoff, no request deduplication for auth endpoints.',
    },
  ];

  for (const c of checks) {
    const r = await verify(c.key, c.question, c.criteria);
    console.log(`${r.key}: P(yes)=${(r.pYes * 100).toFixed(1)}%`);
  }
}

run().catch(console.error);