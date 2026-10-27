import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
const root = new URL('../', import.meta.url).pathname;
const samples = JSON.parse(readFileSync(`${root}tests/fixtures.json`, 'utf8'));
const { values: { only } } = parseArgs({ options: { only: { type: 'string' } } });
if (only !== undefined && !samples.some(sample => sample.name === only)) {
  throw new Error(`Unknown fixture: ${only}. Available: ${samples.map(sample => sample.name).join(', ')}`);
}
const selected = only === undefined ? samples : samples.filter(sample => sample.name === only);
mkdirSync(`${root}build/samples`, { recursive: true });
await Promise.all(selected.map(async sample => {
  const file = `${root}build/samples/${sample.name}`;
  const digest = () => createHash('sha256').update(readFileSync(file)).digest('hex');
  if (!existsSync(file) || digest() !== sample.sha256) {
    await new Promise((resolve, reject) => {
      const child = spawn('curl', ['-fsSL', '--retry', '3', '--connect-timeout', '20', new URL(sample.url).href, '-o', file], { stdio: 'inherit' });
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Download failed: ${sample.name}`)));
    });
  }
  if (digest() !== sample.sha256) throw new Error(`Checksum mismatch: ${sample.name}`);
  console.log(`${sample.name}: SHA-256 verified (${sample.license})`);
}));
