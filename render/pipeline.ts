#!/usr/bin/env node
/**
 * pipeline.ts — Full record → sync → validate → render pipeline.
 * Usage: npm run pipeline -- <APP_URL> [--project <id>] [--user <u>] [--pass <p>]
 */

import {execSync} from 'child_process';
import * as path  from 'path';

const args      = process.argv.slice(2);
const APP_URL   = args.find(a => a.startsWith('http')) || process.env.APP_URL || '';
const PROJECT   = args[args.indexOf('--project') + 1] || 'rheem';
const USER_FLAG = args[args.indexOf('--user')    + 1] ? '--user ' + args[args.indexOf('--user') + 1] : '';
const PASS_FLAG = args[args.indexOf('--pass')    + 1] ? '--pass ' + args[args.indexOf('--pass') + 1] : '';

function run(label: string, cmd: string) {
  console.log('\n' + '='.repeat(60));
  console.log('STEP: ' + label);
  console.log('='.repeat(60));
  execSync(cmd, {stdio: 'inherit'});
}

async function main() {
  if (!APP_URL) { console.error('Usage: npm run pipeline -- <APP_URL> [--project <id>]'); process.exit(1); }

  console.log('Pipeline starting for project: ' + PROJECT);
  console.log('App URL: ' + APP_URL);

  const tsNode = 'npx ts-node --project tsconfig.scripts.json';

  run('Record',   tsNode + ' automation/record.ts ' + APP_URL + ' ' + USER_FLAG + ' ' + PASS_FLAG + ' --project ' + PROJECT);
  run('Sync',     tsNode + ' automation/sync.ts ' + PROJECT);
  run('Validate', tsNode + ' render/validate.ts ' + PROJECT);
  run('Render',   'npx remotion render RheemDemo out/' + PROJECT + '-demo.mp4 --codec=h264');

  console.log('\nPipeline complete! Output: out/' + PROJECT + '-demo.mp4');
}

main().catch(e => { console.error(e); process.exit(1); });
