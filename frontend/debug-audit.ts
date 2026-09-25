#!/usr/bin/env npx tsx
// Quick test: single focused question
import 'dotenv/config';
import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import { readFileSync } from 'fs';

const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY });

const authCacheCode = readFileSync('./src/lib/auth-cache.ts', 'utf-8');

async function test() {
  console.log('Testing single question...\n');
  
  const result = await client.systemOne({
    state: {
      code: authCacheCode,
      note: 'withBearerToken at lines 27-33: checks result.reason === "ok" then returns { ...headers, Authorization: `Bearer ${result.token}` }. mintTokenOnce at lines 84-125: fetches /api/auth/token, validates response, returns token string.'
    },
    questions: {
      timing_attack: noul({
        question: 'In withBearerToken (lines 27-33) or mintTokenOnce (lines 84-125), is any secret/token compared using non-constant-time equality (===, ==) instead of crypto.timingSafeEqual?',
        criteria: 'Look for direct string comparison of tokens, HMACs, or secrets. withBearerToken only checks result.reason === "ok" (enum). mintTokenOnce checks token string existence and type. No HMAC verification visible.',
      }),
    },
  });

  console.log('Raw response:', JSON.stringify(result, null, 2));
}

test().catch(console.error);