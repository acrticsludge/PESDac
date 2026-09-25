#!/usr/bin/env npx tsx
// TypeSafe/Jev audit of PESDac auth flow
// Run: npx tsx --env-file=.env audit-auth.ts
// or: TYPESAFE_API_KEY=sk_... npx tsx audit-auth.ts

import 'dotenv/config';
import { TypeSafeClient, choice, noul, score } from '@typesafe-ai/sdk';
import { readFileSync } from 'fs';

const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY });

const authCode = readFileSync('./src/lib/auth.ts', 'utf-8');
const authCacheCode = readFileSync('./src/lib/auth-cache.ts', 'utf-8');
const middlewareCode = readFileSync('./src/middleware.ts', 'utf-8');

const state = {
  auth_ts: authCode,
  auth_cache_ts: authCacheCode,
  middleware_ts: middlewareCode,
  // Key patterns to look for
  notes: `
Key code patterns in this codebase:
- withBearerToken() in auth-cache.ts:27-33 returns null for non-ok tokens, builds Authorization header only on success
- mintTokenOnce() in auth-cache.ts:84-125 calls /api/auth/token with credentials:include, classifies errors by status
- mintTokenWithRetry() retries once on timeout/network/rate-limited/server errors (not client errors)
- clearAuthCache() clears cachedToken, inFlightToken, all identity-scoped caches, bumps authEpoch
- apiFetch() in auth.ts:1111-1198 gets token via getBackendToken(), attaches Bearer header, handles 401 via authRequiredError()
- authRequiredError() clears cache, dispatches pesdac:auth-required event, deduplicates with __pesdacAuthDispatched flag
- linkPassword() POSTs to /api/link-password same-origin with credentials, uses AbortController timeout
- apiDeleteAccount() calls DELETE /users/me then authClient.deleteUser(), clears identity heap on success
- Identity-scoped caches (currentMeCache, currentProfileCache, currentAccountsCache) keyed by userId with isStaleTagged() check
- 2FA enable/disable uses authClient.twoFactor.enable/verifyTotp/disable with optional password for credential users
- Middleware blocks /mockup routes in prod, compresses text responses with brotli/gzip, skips event-stream
  `,
};

async function runAudit() {
  console.log('🔍 Running TypeSafe/Jev auth audit...\n');

  const result = await client.systemOne({
    state,
    questions: {
      // ===== AUTHENTICATION VULNERABILITIES =====
      timing_attack_token_compare: noul({
        question: 'In withBearerToken (auth-cache.ts:27-33) or mintTokenOnce (auth-cache.ts:84-125), is any secret/token compared using non-constant-time equality (===, ==) instead of crypto.timingSafeEqual?',
        criteria: 'Look for direct string comparison of tokens, HMACs, or secrets. withBearerToken only checks result.reason === "ok" (enum), mintTokenOnce checks token string existence. No HMAC verification visible in provided code.',
      }),
      brute_force_token_mint: noul({
        question: 'Does the /api/auth/token endpoint (called by mintTokenOnce in auth-cache.ts:92) have any rate limiting, brute force protection, or enumeration resistance visible in the client-side code?',
        criteria: 'mintTokenOnce classifies 429 as "rate-limited" and retries once, but no client-side rate limiting, backoff escalation, or request throttling is implemented. Server-side protections not visible in this code.',
      }),
      session_fixation: noul({
        question: 'Does the authentication flow accept a session ID from user input (URL, body, header) without regenerating it on login/privilege change? BetterAuth session cookie is httpOnly per auth.ts:196.',
        criteria: 'Session fixation requires attacker to set victim session ID. BetterAuth uses httpOnly cookies (not accessible via JS). auth.ts:196-199 notes epoch-based validation, not session ID acceptance from input.',
      }),
      token_replay: noul({
        question: 'Can backend JWT tokens (from /api/auth/token) be replayed? Tokens cached for 5min (TOKEN_TTL_MS=300000 in auth.ts:1043) with no nonce, timestamp validation, or replay detection visible.',
        criteria: 'Token cached in memory for 5 minutes. No jti/nonce in token payload visible. No server-side replay detection in client code. Replay possible within TTL window.',
      }),
      csrf_link_password: noul({
        question: 'Is the /api/link-password endpoint (auth.ts:632-671) vulnerable to CSRF? It POSTs same-origin with credentials:include, no CSRF token, no Origin header check visible.',
        criteria: 'Same-origin POST with cookies but no CSRF token generation/validation, no SameSite=Strict enforcement visible, no Origin/Referer verification. Relies on browser SameSite defaults.',
      }),
      info_leak_auth_errors: noul({
        question: 'Do auth error responses (apiFetch in auth.ts:1186-1196, linkPassword in auth.ts:650-668) distinguish between "user not found", "wrong password", "invalid token" in user-visible messages?',
        criteria: 'toUserMessage (imported from api/errors.ts) normalizes errors. ApiError wraps backend envelope. Need to check if distinct error codes leak user existence. BetterAuth typically normalizes.',
      }),
      weak_crypto_tokens: noul({
        question: 'Are weak crypto algorithms (MD5, SHA1, custom) used for token signing? Backend JWT signing algorithm not visible in client code. BetterAuth defaults to HS256/RS256.',
        criteria: 'Client code only consumes tokens, does not sign/verify. Crypto strength depends on BetterAuth server config (not in provided files). No custom crypto in client.',
      }),

      // ===== AUTHORIZATION / ACCESS CONTROL =====
      idor_account_deletion: noul({
        question: 'Does apiDeleteAccount (auth.ts:1333-1372) have IDOR? It calls DELETE /users/me (no user ID param) then authClient.deleteUser(). User ID from session, not request.',
        criteria: 'DELETE /users/me uses session context (me), not user-supplied ID. authClient.deleteUser() uses current session. No IDOR vector visible.',
      }),
      privilege_escalation_2fa: noul({
        question: 'Can 2FA be disabled without password re-auth? disableTwoFactor (auth.ts:692-699) passes password for credential users (password != null), omits for passwordless. verifyTwoFactorSetup (auth.ts:517-538) only verifies TOTP code.',
        criteria: 'disableTwoFactor requires password for credential users (line 694). verifySignInTwoFactor only needs code (line 532). Setup verification (verifyTwoFactorSetup) only needs code. No password re-auth for setup completion.',
      }),
      cache_poisoning_cross_user: noul({
        question: 'Can identity-scoped caches (currentMeCache, currentProfileCache, currentAccountsCache in auth.ts) leak data between users? Caches keyed by userId, validated via isStaleTagged() on resolve.',
        criteria: 'sharedTaggedFetch (auth-cache.ts:58-75) stores userId with promise. isStaleTagged checks entry.userId === currentUserId before fulfilling. clearAuthCache nulls all caches on identity transition. Cross-user leak unlikely.',
      }),

      // ===== SESSION / TOKEN MANAGEMENT =====
      token_exposure_logs: noul({
        question: 'Are tokens/secrets logged in error paths? apiFetch (auth.ts:1184-1195) logs res.text() to const text, parsed via safeJson. No console.log of Authorization headers or tokens visible.',
        criteria: 'No console.log/error of tokens, Authorization headers, or raw secrets in provided code. Errors wrapped in ApiError/AuthRequiredError with user-safe messages via toUserMessage.',
      }),
      stale_token_after_logout: noul({
        question: 'Can a token remain valid after logout/401? clearAuthCache (auth.ts:1099-1109) nulls cachedToken, inFlightToken, all identity caches, bumps authEpoch. apiLogout calls clearIdentityHeap which calls clearAuthCache.',
        criteria: 'clearAuthCache explicitly nulls cachedToken and inFlightToken. authEpoch bump invalidates any in-flight requests via isStaleTagged. Server-side revocation via authClient.signOut() also called. Stale token unlikely.',
      }),
      infinite_token_lifetime: noul({
        question: 'Do backend JWTs have excessive TTL? Client caches token for 5min (TOKEN_TTL_MS=300000). Server-side JWT exp not visible in client. BetterAuth default 15min per auth.ts:1030 comment.',
        criteria: 'Client TTL 5min (conservative). Server issues 15min JWTs per comment. No evidence of excessive lifetime. Rotation via re-mint on cache expiry.',
      }),

      // ===== RATE LIMITING / DOS =====
      rate_limit_token_mint: noul({
        question: 'Is client-side rate limiting implemented for /api/auth/token calls? mintTokenWithRetry retries once on 429/5xx after 200ms backoff. No token bucket, leaky bucket, or per-user/IP throttling in client.',
        criteria: 'Only one retry with fixed 200ms backoff. No proactive rate limiting, no request queuing, no per-session/IP counters. Relies entirely on server-side rate limiting.',
      }),
      rate_limit_auth_endpoints: noul({
        question: 'Are signIn, signUp, changePassword, linkPassword rate limited client-side? auth.ts functions call authClient methods directly with no throttling, debouncing, or retry logic.',
        criteria: 'signIn/signUp/signInWithGoogle/linkPassword/changePassword call authClient directly. No client-side rate limiting, no exponential backoff, no request deduplication for auth endpoints.',
      }),

      // ===== SEVERITY & CLASSIFICATION =====
      overall_auth_severity: score(
        'What is the overall severity of authentication vulnerabilities in this codebase?',
        ['none', 'low', 'medium', 'high', 'critical'],
      ),
      top_risk_category: choice(
        'Which vulnerability category poses the highest risk?',
        {
          session_management: 'Issues with session creation, validation, or termination',
          token_handling: 'Problems with token generation, storage, or validation',
          csrf: 'Cross-site request forgery vulnerabilities',
          rate_limiting: 'Missing or insufficient rate limiting on auth endpoints',
          information_disclosure: 'Leaking user existence, token validity, or internal state',
          authorization_bypass: 'IDOR, privilege escalation, or cache poisoning',
          crypto_weakness: 'Weak algorithms, improper key management',
          none: 'No significant vulnerabilities detected',
        },
      ),
      auth_pattern: choice(
        'What authentication pattern is primarily implemented?',
        {
          jwt_bearer: 'JWT tokens in Authorization header',
          session_cookie: 'Server-side sessions with httpOnly cookies',
          hybrid: 'Both JWT for API and sessions for browser',
          custom: 'Proprietary auth implementation',
          oauth_only: 'Only OAuth/social login, no credentials',
        },
      ),
    },
  });

  // ===== REPORT =====
  console.log('═══════════════════════════════════════');
  console.log('   TYPE SAFE / JEV AUTH AUDIT REPORT');
  console.log('═══════════════════════════════════════\n');

  const vulns = [
    { key: 'timing_attack_token_compare', name: 'Timing Attack on Token Comparison' },
    { key: 'brute_force_token_mint', name: 'Brute Force on Token Mint' },
    { key: 'session_fixation', name: 'Session Fixation' },
    { key: 'token_replay', name: 'Token Replay' },
    { key: 'csrf_link_password', name: 'CSRF on Link Password' },
    { key: 'info_leak_auth_errors', name: 'Information Leak in Auth Errors' },
    { key: 'weak_crypto_tokens', name: 'Weak Cryptography for Tokens' },
    { key: 'idor_account_deletion', name: 'IDOR in Account Deletion' },
    { key: 'privilege_escalation_2fa', name: '2FA Privilege Escalation' },
    { key: 'cache_poisoning_cross_user', name: 'Cross-User Cache Poisoning' },
    { key: 'token_exposure_logs', name: 'Token Exposure in Logs' },
    { key: 'stale_token_after_logout', name: 'Stale Token After Logout' },
    { key: 'infinite_token_lifetime', name: 'Excessive Token Lifetime' },
    { key: 'rate_limit_token_mint', name: 'Missing Rate Limit on Token Mint' },
    { key: 'rate_limit_auth_endpoints', name: 'Missing Rate Limit on Auth Endpoints' },
  ];

  let found = 0;
  for (const v of vulns) {
    const ans = result.answers?.[v.key];
    if (!ans) continue;
    
    // Noul response: { noul: number (probability 0-1) }
    // Choice response: { choice: string, confidence: number }
    // Score response: { score: number, confidence: number, legend: {...} }
    const pYes = typeof ans.noul === 'number' ? ans.noul : (ans.probability ?? 0);
    const pNo = 1 - pYes;
    const conf = ans.confidence ?? 0;
    
    let status: string;
    
    if (pYes > 0.65) {
      status = '⚠️  LIKELY';
    } else if (pYes < 0.35) {
      status = '✅ UNLIKELY';
    } else {
      status = '❓ UNCERTAIN';
    }

    const shouldFlag = pYes > 0.4; // flag anything leaning yes
    
    if (shouldFlag) {
      found++;
      console.log(`${status}  ${v.name}`);
      console.log(`       P(yes): ${(pYes * 100).toFixed(1)}% | P(no): ${(pNo * 100).toFixed(1)}%${conf > 0 ? ` | Confidence: ${(conf * 100).toFixed(1)}%` : ''}`);
      console.log();
    } else {
      console.log(`${status}  ${v.name}`);
      console.log(`       P(yes): ${(pYes * 100).toFixed(1)}% | P(no): ${(pNo * 100).toFixed(1)}%${conf > 0 ? ` | Confidence: ${(conf * 100).toFixed(1)}%` : ''}`);
      console.log();
    }
  }

  console.log('────────────────────────────────────────');
  console.log(`Vulnerabilities flagged: ${found}/${vulns.length}\n`);

  const severity = result.answers?.overall_auth_severity;
  const severityLabel = severity?.legend?.[Math.round(severity?.score ?? 0)] ?? 'UNKNOWN';
  console.log(`Overall Severity: ${severityLabel} (confidence: ${(severity?.confidence ?? 0) * 100}%)`);

  const topRisk = result.answers?.top_risk_category;
  console.log(`Top Risk Category: ${topRisk?.choice ?? 'UNKNOWN'} (confidence: ${(topRisk?.confidence ?? 0) * 100}%)`);

  const pattern = result.answers?.auth_pattern;
  console.log(`Auth Pattern: ${pattern?.choice ?? 'UNKNOWN'} (confidence: ${(pattern?.confidence ?? 0) * 100}%)`);

  console.log('\n═══════════════════════════════════════');
  console.log('   RECOMMENDED ACTIONS');
  console.log('═══════════════════════════════════════\n');

  function isLikely(key: string): boolean {
    const ans = result.answers?.[key];
    return typeof ans?.noul === 'number' && ans.noul > 0.65;
  }

  if (isLikely('timing_attack_token_compare')) {
    console.log('1. Use constant-time comparison (crypto.timingSafeEqual) for token/HMAC verification');
  }
  if (isLikely('brute_force_token_mint')) {
    console.log('2. Add rate limiting to /api/auth/token (per-IP + per-session)');
  }
  if (isLikely('csrf_link_password')) {
    console.log('3. Add CSRF protection to /api/link-password (SameSite=Strict + Origin check)');
  }
  if (isLikely('cache_poisoning_cross_user')) {
    console.log('4. Verify identity-scoped cache keys include userId; clear on every identity transition');
  }
  if (isLikely('rate_limit_auth_endpoints')) {
    console.log('5. Implement rate limiting on signIn, signUp, changePassword, linkPassword');
  }
  if (isLikely('info_leak_auth_errors')) {
    console.log('6. Normalize auth error messages (same response for invalid user vs invalid password)');
  }

  // Token usage
  if (result.usage) {
    console.log('\n📊 Token Usage:');
    console.log(`   Prompt: ${result.usage.prompt_tokens}`);
    console.log(`   Completion: ${result.usage.completion_tokens}`);
    console.log(`   Total: ${result.usage.total_tokens}`);
  }
}

runAudit().catch(console.error);