#!/usr/bin/env npx tsx
// Token Exposure in Logs Audit
import 'dotenv/config';
import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import { readFileSync } from 'fs';

const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY });

const authCode = readFileSync('./src/lib/auth.ts', 'utf-8');
const authCacheCode = readFileSync('./src/lib/auth-cache.ts', 'utf-8');

const state = {
  auth_ts: authCode,
  auth_cache_ts: authCacheCode,
  note: 'apiFetch (auth.ts:1184-1195) parses res.text() via safeJson. No console.log/error of Authorization headers, Bearer tokens, or raw secrets. Errors wrapped in ApiError/AuthRequiredError.',
};

async function run() {
  const result = await client.systemOne({
    state,
    questions: {
      token_exposure_logs: noul({
        question: 'Are tokens, Authorization headers, or secrets logged via console.log/error in auth.ts or auth-cache.ts?',
        criteria: 'Search for console.log/error/warn/info with: Authorization header, Bearer token, token variable, cachedToken, result.token, or any secret. Code uses safeJson to parse responses but does not log raw tokens.',
      }),
    },
  });

  const ans = result.answers?.token_exposure_logs;
  const pYes = ans?.noul ?? 0;
  return { name: 'Token Exposure in Logs', pYes, severity: pYes > 0.65 ? 'high' : pYes > 0.4 ? 'medium' : 'low', detail: 'No tokens logged in current code; verify toUserMessage does not leak secrets' };
}

run().then(r => console.log(JSON.stringify(r))).catch(console.error);