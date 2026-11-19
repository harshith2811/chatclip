#!/usr/bin/env node
/**
 * e2e/run_all.js
 * Master E2E Test Runner for YouTube Clipping Intelligence & OmniPost.
 * Accepts flags:
 *   --tier=1|2|3|4|harness|all
 *   --mode=mock|live
 *   --filter=<pattern>
 *
 * Automatically manages test server lifecycle, collects results, and renders
 * a formatted execution summary table.
 */

import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { startTestServer, stopTestServer } from './harness/mock_backend.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CLI Argument Parsing
const args = process.argv.slice(2);
const tierArg = (args.find(a => a.startsWith('--tier='))?.split('=')[1] || 'all').toLowerCase();
const modeArg = (args.find(a => a.startsWith('--mode='))?.split('=')[1] || 'mock').toLowerCase();
const filterArg = args.find(a => a.startsWith('--filter='))?.split('=')[1] || null;

console.log('\n==================================================================================');
console.log('              YouTube Clipping Intelligence & OmniPost E2E Test Suite             ');
console.log('==================================================================================');
console.log(` Mode: ${modeArg.toUpperCase()} | Target Tier: ${tierArg.toUpperCase()} | Filter: ${filterArg || 'NONE'}`);
console.log(` Node Runtime: ${process.version} | Timestamp: ${new Date().toISOString()}`);
console.log('----------------------------------------------------------------------------------\n');

// Ensure tier directories exist
const tierDirs = {
  harness: { name: 'Tier 0: Test Harness Certification', dir: path.join(__dirname, 'harness') },
  1: { name: 'Tier 1: Feature Coverage (F1-F40)', dir: path.join(__dirname, 'tier1_features') },
  2: { name: 'Tier 2: Boundary & Security (F1-F40)', dir: path.join(__dirname, 'tier2_boundaries') },
  3: { name: 'Tier 3: Combinatorial Pairwise Interactions', dir: path.join(__dirname, 'tier3_combinations') },
  4: { name: 'Tier 4: Multi-User Real-World Workflows', dir: path.join(__dirname, 'tier4_workflows') }
};

for (const [, cfg] of Object.entries(tierDirs)) {
  if (!fs.existsSync(cfg.dir)) {
    fs.mkdirSync(cfg.dir, { recursive: true });
  }
}

function getTestFiles(dir, isHarness = false) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir);
  return entries
    .filter(f => f.endsWith('.test.js'))
    .filter(f => isHarness ? f === 'harness.test.js' : f !== 'harness.test.js')
    .filter(f => !filterArg || f.toLowerCase().includes(filterArg.toLowerCase()))
    .map(f => path.join(dir, f));
}

let serverInfo = null;
if (modeArg === 'mock') {
  serverInfo = await startTestServer({ port: 0 });
  process.env.E2E_BASE_URL_FASTAPI = serverInfo.baseUrl;
  process.env.E2E_BASE_URL_OMNIPOST = serverInfo.baseUrl;
  process.env.FASTAPI_URL = serverInfo.baseUrl;
  process.env.OMNIPOST_URL = serverInfo.baseUrl;
  console.log(`[Harness] Mock backend listening on ${serverInfo.baseUrl}\n`);
}

let targetTierKeys = [];
if (tierArg === 'all') {
  targetTierKeys = ['harness', '1', '2', '3', '4'];
} else if (tierArg === 'harness' || tierArg === '0') {
  targetTierKeys = ['harness'];
} else {
  targetTierKeys = [tierArg];
}

const tierResults = [];
let grandTotalTests = 0;
let grandTotalPassed = 0;
let grandTotalFailed = 0;
let grandTotalSkipped = 0;
const overallStartTime = Date.now();

for (const tKey of targetTierKeys) {
  const tierConfig = tierDirs[tKey];
  if (!tierConfig) continue;

  const isHarness = tKey === 'harness';
  const files = getTestFiles(tierConfig.dir, isHarness);

  const tierStartTime = Date.now();
  let tierTests = 0;
  let tierPassed = 0;
  let tierFailed = 0;
  let tierSkipped = 0;

  if (files.length > 0) {
    console.log(`▶ Executing ${tierConfig.name} (${files.length} suite${files.length > 1 ? 's' : ''})...`);

    const testStream = run({ files, concurrency: false });

    testStream.on('test:pass', (t) => {
      // console.log('DEBUG PASS:', t.name, 'type:', t.details?.type);
      if (t.details?.type === 'test') {
        tierPassed++;
        tierTests++;
      }
    });

    testStream.on('test:fail', (t) => {
      if (t.details?.type === 'test') {
        tierFailed++;
        tierTests++;
      }
    });

    testStream.on('test:skip', (t) => {
      if (t.details?.type === 'test') {
        tierSkipped++;
        tierTests++;
      }
    });

    testStream.compose(spec).pipe(process.stdout);
    await new Promise(resolve => testStream.on('end', resolve));
  } else {
    console.log(`○ Skipping ${tierConfig.name} (0 test suites found)`);
  }

  const durationSec = ((Date.now() - tierStartTime) / 1000).toFixed(2);
  tierResults.push({
    tier: tKey === 'harness' ? 'Tier 0' : `Tier ${tKey}`,
    name: tierConfig.name,
    suites: files.length,
    tests: tierTests,
    passed: tierPassed,
    failed: tierFailed,
    skipped: tierSkipped,
    duration: `${durationSec}s`
  });

  grandTotalTests += tierTests;
  grandTotalPassed += tierPassed;
  grandTotalFailed += tierFailed;
  grandTotalSkipped += tierSkipped;
}

if (serverInfo) {
  await stopTestServer({ force: true });
  console.log('\n[Harness] Mock backend stopped cleanly.');
}

const totalDurationSec = ((Date.now() - overallStartTime) / 1000).toFixed(2);

// Formatted ASCII Summary Table
console.log('\n==================================================================================');
console.log('                              E2E EXECUTION SUMMARY                              ');
console.log('==================================================================================');
console.log(' Tier    Name                           Suites  Tests  Passed  Failed  Skipped  Duration');
console.log('----------------------------------------------------------------------------------');

for (const r of tierResults) {
  const tierStr = r.tier.padEnd(7);
  const nameStr = r.name.padEnd(30).slice(0, 30);
  const suitesStr = String(r.suites).padStart(6);
  const testsStr = String(r.tests).padStart(6);
  const passedStr = String(r.passed).padStart(7);
  const failedStr = String(r.failed).padStart(7);
  const skippedStr = String(r.skipped).padStart(8);
  const durStr = r.duration.padStart(9);
  console.log(` ${tierStr} ${nameStr} ${suitesStr} ${testsStr} ${passedStr} ${failedStr} ${skippedStr} ${durStr}`);
}

console.log('----------------------------------------------------------------------------------');
const totalSuites = tierResults.reduce((a, c) => a + c.suites, 0);
console.log(` TOTAL                                  ${String(totalSuites).padStart(6)} ${String(grandTotalTests).padStart(6)} ${String(grandTotalPassed).padStart(7)} ${String(grandTotalFailed).padStart(7)} ${String(grandTotalSkipped).padStart(8)} ${String(totalDurationSec + 's').padStart(9)}`);
console.log('==================================================================================');

if (grandTotalFailed > 0) {
  console.error(`\n❌ FAILED: ${grandTotalFailed} test(s) failed out of ${grandTotalTests}.\n`);
  process.exit(1);
} else {
  console.log(`\n✅ SUCCESS: All ${grandTotalTests} tests passed cleanly (100% Pass Rate).\n`);
  process.exit(0);
}
