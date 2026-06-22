/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// CaptRAW Database Backup Script
// Usage: node scripts/backup-db.mjs [--restore <file>]
//
// Backs up the PostgreSQL database to ./backups/<timestamp>.sql.gz
// Restore with: node scripts/backup-db.mjs --restore ./backups/xxx.sql.gz

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const backupDir = join(rootDir, 'backups');
const containerName = 'captraw-postgres';
const dbUser = 'misskey';
const dbName = 'misskey';

function log(msg) {
	console.log(`[backup] ${new Date().toISOString()} ${msg}`);
}

function run(cmd) {
	return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'inherit'] }).trim();
}

function listBackups() {
	if (!existsSync(backupDir)) {
		log('No backups directory found.');
		return [];
	}
	const files = readdirSync(backupDir).filter(f => f.endsWith('.sql.gz')).sort().reverse();
	if (files.length === 0) {
		log('No backups found.');
		return [];
	}
	console.log('Available backups:');
	files.forEach((f, i) => {
		console.log(`  ${i + 1}. ${f}`);
	});
	return files;
}

function doBackup() {
	mkdirSync(backupDir, { recursive: true });
	const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const file = join(backupDir, `${ts}.sql.gz`);

	log(`Backing up database "${dbName}"...`);
	try {
		run(`docker exec ${containerName} pg_dump -U ${dbUser} -d ${dbName} --clean --if-exists | gzip > "${file}"`);
		log(`Backup saved: ${file}`);
	} catch (err) {
		log(`Backup FAILED: ${err.message}`);
		process.exit(1);
	}

	// Keep only last 30 backups
	const files = readdirSync(backupDir).filter(f => f.endsWith('.sql.gz')).sort();
	if (files.length > 30) {
		const toDelete = files.slice(0, files.length - 30);
		toDelete.forEach(f => {
			const { unlinkSync } = require('node:fs');
			unlinkSync(join(backupDir, f));
			log(`Removed old backup: ${f}`);
		});
	}
}

function doRestore(file) {
	if (!existsSync(file)) {
		log(`File not found: ${file}`);
		process.exit(1);
	}

	log(`WARNING: This will REPLACE all data in "${dbName}" with the contents of ${file}`);
	log('Starting restore in 3 seconds...');
	execSync('timeout /t 3 /nobreak >nul 2>&1 || sleep 3', { stdio: 'ignore' });

	log('Restoring...');
	try {
		run(`gzip -dc "${file}" | docker exec -i ${containerName} psql -U ${dbUser} -d ${dbName}`);
		log('Restore completed successfully.');
	} catch (err) {
		log(`Restore FAILED: ${err.message}`);
		process.exit(1);
	}
}

// CLI
const args = process.argv.slice(2);
if (args.includes('--list')) {
	listBackups();
} else if (args.includes('--restore')) {
	const idx = args.indexOf('--restore');
	const file = args[idx + 1];
	if (!file) {
		log('Usage: node scripts/backup-db.mjs --restore <file>');
		process.exit(1);
	}
	doRestore(file);
} else {
	doBackup();
}
