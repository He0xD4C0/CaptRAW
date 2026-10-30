import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';

const python=resolve('build/qa-venv/bin/python');
const output=execFileSync(python,['tests/integration/color/display-p3-chain.py'],{encoding:'utf8'});
const report=JSON.parse(output.trim().split('\n').at(-1));
if(report.samples!==216||report.meanDeltaE00>.2||report.maxDeltaE00>1||report.displayMeanDeltaE00>.2||report.displayMaxDeltaE00>1||report.proofMeanDeltaE00>.2||report.proofMaxDeltaE00>1)throw new Error('P3 color-chain thresholds failed');
console.log('PASS Display P3 float transport, sRGB target clipping and signed extended values within independent thresholds');
