/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Misskey Production Deploy Script
 *
 * Usage:
 *   node scripts/deploy.mjs              # git pull + build + migrate + restart
 *   node scripts/deploy.mjs --skip-pull   # skip git pull (code already synced)
 *   node scripts/deploy.mjs --skip-build  # skip pnpm build (only migrate + restart)
 *   node scripts/deploy.mjs --dry-run     # show what would be done without executing
 *
 * Environment variables:
 *   MISSKEY_SERVICE_PORT  — backend port to restart (default: 3000)
 *   MISSKEY_LOG_FILE      — log file for the restarted service (default: ./misskey.log)
 *   GIT_BRANCH            — branch to pull (default: current branch)
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { platform } from 'node:os';

const ROOT = resolve(import.meta.dirname, '..');
const isWindows = platform() === 'win32';

// ── CLI args ──────────────────────────────────────────────
const args = process.argv.slice(2);
const skipPull = args.includes('--skip-pull');
const skipBuild = args.includes('--skip-build');
const dryRun = args.includes('--dry-run');

const PORT = process.env.MISSKEY_SERVICE_PORT ?? '3000';
const LOG_FILE = process.env.MISSKEY_LOG_FILE ?? resolve(ROOT, 'misskey.log');
const BRANCH = process.env.GIT_BRANCH ?? '';

// ── Helpers ───────────────────────────────────────────────
function log(icon, msg) {
	const ts = new Date().toLocaleTimeString();
	console.log(`[${ts}] ${icon}  ${msg}`);
}

function fatal(msg) {
	log('❌', msg);
	process.exit(1);
}

function run(cmd, opts = {}) {
	log('▶', cmd);
	if (dryRun) return '';
	try {
		return execSync(cmd, {
			cwd: ROOT,
			stdio: 'inherit',
			timeout: opts.timeout ?? 600_000, // 10 min default
			...opts,
		});
	} catch (err) {
		if (opts.allowFail) return '';
		fatal(`Command failed: ${cmd}\n${err.message}`);
	}
}

function runSilent(cmd) {
	try {
		return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', timeout: 30_000 }).trim();
	} catch {
		return '';
	}
}

// ── Preflight ─────────────────────────────────────────────
log('🚀', 'Misskey deploy started');
log('📋', `Platform: ${platform()}`);
log('📋', `Root: ${ROOT}`);
log('📋', `Skip pull: ${skipPull} | Skip build: ${skipBuild} | Dry run: ${dryRun}`);

if (!existsSync(resolve(ROOT, '.git'))) {
	fatal('Not a git repository. Run this script from the Misskey root.');
}

if (!existsSync(resolve(ROOT, '.config/default.yml')) && !dryRun) {
	fatal('.config/default.yml not found. Configure Misskey before deploying.');
}

// ── Step 1: Git sync ──────────────────────────────────────
if (!skipPull) {
	log('📥', 'Syncing code from remote...');
	const branch = BRANCH || runSilent('git rev-parse --abbrev-ref HEAD');
	run(`git fetch origin ${branch}`, { timeout: 120_000 });

	// Save current HEAD for rollback reference
	const prevHead = runSilent('git rev-parse --short HEAD');
	log('📋', `Current HEAD: ${prevHead}`);

	run(`git reset --hard origin/${branch}`, { timeout: 60_000 });

	const newHead = runSilent('git rev-parse --short HEAD');
	log('✅', `Updated ${prevHead} → ${newHead}`);
} else {
	log('⏭️', 'Skipping git pull (--skip-pull)');
}

// ── Step 2: Install dependencies ──────────────────────────
log('📦', 'Installing dependencies...');
run('pnpm install --frozen-lockfile', { timeout: 600_000, allowFail: true });
// Fallback: if lockfile changed, allow modification
if (!dryRun) {
	try {
		execSync('pnpm install --no-frozen-lockfile', { cwd: ROOT, stdio: 'inherit', timeout: 600_000 });
	} catch {
		log('⚠️', 'pnpm install had warnings (non-fatal, continuing)');
	}
}

// ── Step 3: Build ─────────────────────────────────────────
if (!skipBuild) {
	log('🔨', 'Building all packages...');
	run('pnpm build', { timeout: 1_200_000 }); // 20 min
} else {
	log('⏭️', 'Skipping build (--skip-build)');
}

// ── Step 4: Database migrations ───────────────────────────
log('🗃️', 'Running database migrations...');
run('pnpm migrate', { timeout: 300_000 });

// ── Step 5: Restart service ───────────────────────────────
log('🔄', 'Restarting Misskey service...');

if (!dryRun) {
	// Kill existing Misskey node processes listening on PORT
	if (isWindows) {
		try {
			const psScript = `
				Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue |
					Select-Object -ExpandProperty OwningProcess -Unique |
					ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
			`;
			execSync(`powershell -NoProfile -Command "${psScript.trim()}"`, {
				timeout: 15_000,
				windowsHide: true,
				cwd: ROOT,
			});
			log('✅', `Killed processes on port ${PORT}`);
		} catch {
			log('ℹ️', `No existing process on port ${PORT}`);
		}
	} else {
		try {
			const pids = execSync(`lsof -ti :${PORT}`, { cwd: ROOT, encoding: 'utf-8', timeout: 10_000 })
				.trim().split('\n').filter(Boolean);
			if (pids.length > 0) {
				execSync(`kill -9 ${pids.join(' ')}`, { cwd: ROOT, timeout: 10_000 });
				log('✅', `Killed PIDs [${pids.join(', ')}] on port ${PORT}`);
			} else {
				log('ℹ️', `No existing process on port ${PORT}`);
			}
		} catch {
			log('ℹ️', `No existing process on port ${PORT}`);
		}
	}

	// Wait a moment for port to be fully released
	await new Promise(r => setTimeout(r, 2000));

	// Start Misskey as a detached background process
	const startCmd = 'pnpm';
	const startArgs = ['start'];
	const logStream = (await import('node:fs')).createWriteStream(LOG_FILE, { flags: 'a' });

	const child = spawn(startCmd, startArgs, {
		cwd: ROOT,
		detached: true,
		stdio: ['ignore', logStream, logStream],
		windowsHide: true,
		env: { ...process.env, NODE_ENV: 'production' },
	});
	child.unref();

	log('✅', `Misskey started (PID: ${child.pid})`);
	log('📄', `Log file: ${LOG_FILE}`);
} else {
	log('🔍', `[DRY RUN] Would kill port ${PORT} and restart service`);
}

// ── Done ──────────────────────────────────────────────────
log('🎉', 'Deploy completed successfully!');
log('ℹ️', `Service should be available at http://localhost:${PORT} in a few seconds.`);
