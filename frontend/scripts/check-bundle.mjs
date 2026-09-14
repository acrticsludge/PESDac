// Bundle-regression check (audit §14 item 2): run after `astro build`.
// Fails when the client JS total or any single chunk exceeds its cap.
// Caps (2026-09-14 baseline: total ~994 KB, largest AppLayout ~372 KB):
// total 1.2 MB, single chunk 500 KB (Vite's default warn level).
// Usage: `npm run bundle:check` (needs dist/ from `npm run build`).

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOTAL_CAP = 1_200_000;
const CHUNK_CAP = 500_000;

const dir = fileURLToPath(new URL("../dist/client/_astro/", import.meta.url));
let files;
try {
  files = readdirSync(dir).filter((f) => f.endsWith(".js"));
} catch {
  console.error("bundle:check: dist/client/_astro missing — run `npm run build` first.");
  process.exit(2);
}
let total = 0;
let failed = false;
const rows = files
  .map((f) => ({ f, size: statSync(join(dir, f)).size }))
  .sort((a, b) => b.size - a.size);
for (const { f, size } of rows) {
  total += size;
  const flag = size > CHUNK_CAP ? "  OVER CHUNK CAP" : "";
  if (flag) failed = true;
  console.log(`${(size / 1024).toFixed(1).padStart(8)} KB  ${f}${flag}`);
}
console.log(`${(total / 1024).toFixed(1).padStart(8)} KB  TOTAL`);
if (total > TOTAL_CAP) {
  console.error(`bundle:check: total over ${(TOTAL_CAP / 1024).toFixed(0)} KB cap.`);
  failed = true;
}
process.exit(failed ? 1 : 0);
