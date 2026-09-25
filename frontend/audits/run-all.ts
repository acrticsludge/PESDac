#!/usr/bin/env npx tsx
// Master audit runner - executes focused audits sequentially
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';

interface AuditResult {
  name: string;
  pYes: number;
  severity: 'high' | 'medium' | 'low';
  detail: string;
}

const AUDITS = [
  'token-replay.ts',
  'rate-limit-token-mint.ts',
  'csrf-link-password.ts',
  'rate-limit-auth-endpoints.ts',
  'session-fixation.ts',
  'info-leak.ts',
  'token-exposure.ts',
];

async function runAudit(file: string): Promise<AuditResult | null> {
  console.log(`\n🔍 Running ${file}...`);
  
  const result = spawnSync('node', [
    '--env-file=.env',
    '--import', 'tsx',
    `audits/${file}`
  ], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    timeout: 30000,
  });

  if (result.error) {
    console.error(`  ❌ Failed: ${result.error.message}`);
    return null;
  }

  if (result.status !== 0) {
    console.error(`  ❌ Exit code ${result.status}: ${result.stderr}`);
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout.trim());
    const status = parsed.pYes > 0.65 ? '⚠️  HIGH' : parsed.pYes > 0.4 ? '⚠️  MEDIUM' : '✅ LOW';
    console.log(`  ${status} ${parsed.name}: P(yes)=${(parsed.pYes * 100).toFixed(1)}%`);
    return parsed;
  } catch {
    console.error(`  ❌ Parse error: ${result.stdout}`);
    return null;
  }
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('   TYPE SAFE / JEV AUTH AUDIT SUITE');
  console.log('═══════════════════════════════════════\n');

  const results: AuditResult[] = [];

  for (const audit of AUDITS) {
    if (!existsSync(`audits/${audit}`)) {
      console.log(`  ⏭️  Skipped: ${audit} (not found)`);
      continue;
    }
    const r = await runAudit(audit);
    if (r) results.push(r);
  }

  // Summary
  console.log('\n═══════════════════════════════════════');
  console.log('   SUMMARY');
  console.log('═══════════════════════════════════════\n');

  const high = results.filter(r => r.pYes > 0.65);
  const medium = results.filter(r => r.pYes > 0.4 && r.pYes <= 0.65);
  const low = results.filter(r => r.pYes <= 0.4);

  console.log(`High risk (P>65%):      ${high.length}`);
  console.log(`Medium risk (40-65%):   ${medium.length}`);
  console.log(`Low risk (<40%):        ${low.length}`);
  console.log(`Total audits run:       ${results.length}\n`);

  if (high.length > 0) {
    console.log('🔴 HIGH PRIORITY:');
    for (const r of high) {
      console.log(`  • ${r.name} (${(r.pYes * 100).toFixed(0)}%)`);
      console.log(`    → ${r.detail}`);
    }
    console.log();
  }

  if (medium.length > 0) {
    console.log('🟡 MEDIUM PRIORITY:');
    for (const r of medium) {
      console.log(`  • ${r.name} (${(r.pYes * 100).toFixed(0)}%)`);
      console.log(`    → ${r.detail}`);
    }
    console.log();
  }

  if (low.length > 0) {
    console.log('🟢 LOW / NO RISK:');
    for (const r of low) {
      console.log(`  • ${r.name} (${(r.pYes * 100).toFixed(0)}%)`);
    }
    console.log();
  }

  console.log('═══════════════════════════════════════');
  console.log('   RECOMMENDED FIXES (priority order)');
  console.log('═══════════════════════════════════════\n');

  let fixNum = 1;
  for (const r of [...high, ...medium].sort((a, b) => b.pYes - a.pYes)) {
    console.log(`${fixNum++}. ${r.detail}`);
  }
}

main().catch(console.error);