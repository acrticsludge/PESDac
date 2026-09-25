#!/usr/bin/env npx tsx
// Focused check: Token Exposure in Logs
import 'dotenv/config';
import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import { readFileSync } from 'fs';

const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY });

const authCode = readFileSync('./src/lib/auth.ts', 'utf-8');
const authCacheCode = readFileSync('./src/lib/auth-cache.ts', 'utf-8');

async function test() {
  console.log('Focused: Token Exposure in Logs...\n');
  
  const result = await client.systemOne({
    state: {
      auth_ts: authCode,
      auth_cache_ts: authCacheCode,
    },
    questions: {
      token_exposure_logs: noul({
        question: 'In the provided code (auth.ts and auth-cache.ts), are any tokens, Authorization headers, or secrets logged via console.log, console.error, or similar debug output?',
        criteria: 'Search for console.log/error/warn/info with: Authorization header, Bearer token, token variable, cachedToken, result.token, or any secret. The code uses safeJson to parse responses but does not log raw tokens.',
      }),
    },
  });

  console.log('Raw:', JSON.stringify(result, null, 2));
  
  const ans = result.answers?.token_exposure_logs;
  if (ans) {
    console.log(`\nP(yes): ${(ans.noul * 100).toFixed(1)}%`);
  }
}

test().catch(console.error);