#!/usr/bin/env npx tsx
// Token Replay Audit
import 'dotenv/config';
import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import { readFileSync } from 'fs';

const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY });

const authCode = readFileSync('./src/lib/auth.ts', 'utf-8');
const authCacheCode = readFileSync('./src/lib/auth-cache.ts', 'utf-8');

const state = {
  auth_ts: authCode,
  auth_cache_ts: authCacheCode,
  note: 'mintTokenOnce (auth-cache.ts:84-125) calls /api/auth/token. Tokens cached 5min (TOKEN_TTL_MS=300000, auth.ts:1043). Server issues 15min JWTs (auth.ts:1030). No nonce/jti visible.',
};

async function run() {
  const result = await client.systemOne({
    state,
    questions: {
      token_replay: noul({
        question: 'Can backend JWT tokens be replayed within their 5-minute client-side cache window? Tokens have no nonce, jti, or replay detection visible in client code.',
        criteria: 'Token cached in memory for 5min. Server issues JWTs (15min per comment). No jti/nonce in payload visible. No server-side replay detection in client code. Replay possible within TTL.',
      }),
    },
  });

  const ans = result.answers?.token_replay;
  const pYes = ans?.noul ?? 0;
  return { name: 'Token Replay', pYes, severity: pYes > 0.65 ? 'high' : pYes > 0.4 ? 'medium' : 'low', detail: 'Add nonce/jti to JWTs; implement replay detection on backend' };
}

run().then(r => console.log(JSON.stringify(r))).catch(console.error);