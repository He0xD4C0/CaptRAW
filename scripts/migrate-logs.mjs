/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Migrate logs and PID files from built/ and built-dev/ to logs/ directory structure.
 * Run this once after upgrading to the new log management system.
 */

import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

const migrations = [
	// Production
	{ from: 'built/prod-server.log', to: 'logs/production/server.log' },
	{ from: 'built/prod-server.pid', to: 'logs/production/server.pid' },
	{ from: 'built/supervisor.pid', to: 'logs/production/supervisor.pid' },
	{ from: 'built/supervisor-launcher.bat', to: 'logs/production/supervisor-launcher.bat' },
	// Development
	{ from: 'built-dev/dev-server.log', to: 'logs/development/server.log' },
	{ from: 'built-dev/dev-server.pid', to: 'logs/development/server.pid' },
];

let migratedCount = 0;
let skippedCount = 0;

console.log('Migrating logs and PID files to logs/ directory...\n');

for (const { from, to } of migrations) {
	const fromPath = join(rootDir, from);
	const toPath = join(rootDir, to);

	if (!existsSync(fromPath)) {
		console.log(`⊘ Skip: ${from} (does not exist)`);
		skippedCount++;
		continue;
	}

	mkdirSync(dirname(toPath), { recursive: true });

	try {
		renameSync(fromPath, toPath);
		console.log(`✓ Migrated: ${from} → ${to}`);
		migratedCount++;
	} catch (err) {
		console.error(`✗ Failed: ${from} → ${to} (${err.message})`);
	}
}

console.log(`\nSummary: ${migratedCount} migrated, ${skippedCount} skipped.`);
console.log('Migration complete. You can now safely delete old log files from built/ and built-dev/.');
