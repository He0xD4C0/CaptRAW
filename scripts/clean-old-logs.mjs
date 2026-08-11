/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Clean up old log and PID files from built/ and built-dev/ directories.
 * These files have been migrated to logs/ directory structure.
 */

import { existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

const oldFiles = [
	'built/prod-server.log',
	'built/prod-server.pid',
	'built/supervisor.pid',
	'built/supervisor-launcher.bat',
	'built-dev/dev-server.log',
	'built-dev/dev-server.pid',
];

let removedCount = 0;
let notFoundCount = 0;

console.log('Cleaning up old log and PID files...\n');

for (const file of oldFiles) {
	const filePath = join(rootDir, file);

	if (!existsSync(filePath)) {
		console.log(`⊘ ${file} (not found)`);
		notFoundCount++;
		continue;
	}

	try {
		unlinkSync(filePath);
		console.log(`✓ Removed: ${file}`);
		removedCount++;
	} catch (err) {
		console.error(`✗ Failed to remove: ${file} (${err.message})`);
	}
}

console.log(`\nSummary: ${removedCount} removed, ${notFoundCount} not found.`);

if (removedCount === 0 && notFoundCount === oldFiles.length) {
	console.log('All old files have already been cleaned up. ✓');
}
