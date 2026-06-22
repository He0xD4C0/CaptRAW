/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Cross-platform port killer for Misskey dev environment.
 * Kills processes listening on the Vite frontend (5173), frontend-embed (5174),
 * and optionally backend (3000) ports.
 *
 * Usage:
 *   node scripts/kill-port.js              # kill default ports (5173, 5174)
 *   node scripts/kill-port.js --all        # kill default + backend port (5173, 5174, 3000)
 *   node scripts/kill-port.js 8080 3000    # kill specific ports
 */

import { exec } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const DEFAULT_PORTS = [5173, 5174]; // Vite frontend + frontend-embed
const BACKEND_PORT = 3000;

// Parse CLI arguments
const args = process.argv.slice(2);
const killAll = args.includes('--all');
const customPorts = args
	.filter(a => !a.startsWith('--'))
	.map(Number)
	.filter(n => !isNaN(n) && n > 0);

const ports = customPorts.length > 0
	? customPorts
	: killAll
		? [...DEFAULT_PORTS, BACKEND_PORT]
		: DEFAULT_PORTS;

const isWindows = platform() === 'win32';

/**
 * Kill processes listening on a specific port.
 * @param {number} port
 * @returns {Promise<void>}
 */
async function killPort(port) {
	try {
		if (isWindows) {
			await killPortWindows(port);
		} else {
			await killPortUnix(port);
		}
	} catch {
		// Port not in use — silently succeed
	}
}

/**
 * Windows: use PowerShell Get-NetTCPConnection + taskkill.
 */
async function killPortWindows(port) {
	const psScript = `
		$procs = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue |
			Select-Object -ExpandProperty OwningProcess -Unique;
		if ($procs) { $procs | ForEach-Object { Write-Output $_ } }
	`.trim();

	try {
		const { stdout } = await execAsync(`powershell -NoProfile -Command "${psScript}"`, {
			timeout: 10_000,
			windowsHide: true,
		});

		const pids = stdout
			.split(/[\r\n]+/)
			.map(s => s.trim())
			.filter(s => /^\d+$/.test(s));

		if (pids.length === 0) {
			console.log(`✅ Port ${port}: not in use`);
			return;
		}

		// Kill all PIDs in one taskkill call
		const pidArgs = pids.map(p => `/PID ${p}`).join(' ');
		await execAsync(`taskkill /F ${pidArgs}`, {
			timeout: 10_000,
			windowsHide: true,
		});
		console.log(`✅ Port ${port}: killed PIDs [${pids.join(', ')}]`);
	} catch {
		console.log(`✅ Port ${port}: not in use`);
	}
}

/**
 * macOS / Linux: use lsof + kill -9.
 */
async function killPortUnix(port) {
	try {
		const { stdout } = await execAsync(`lsof -ti :${port}`, { timeout: 10_000 });
		const pids = stdout
			.split(/[\r\n]+/)
			.map(s => s.trim())
			.filter(s => /^\d+$/.test(s));

		if (pids.length === 0) {
			console.log(`✅ Port ${port}: not in use`);
			return;
		}

		await execAsync(`kill -9 ${pids.join(' ')}`, { timeout: 10_000 });
		console.log(`✅ Port ${port}: killed PIDs [${pids.join(', ')}]`);
	} catch {
		console.log(`✅ Port ${port}: not in use`);
	}
}

// Execute
console.log(`🔪 Killing processes on ports: ${ports.join(', ')}\n`);

try {
	await Promise.all(ports.map(p => killPort(p)));
	console.log('\n🎯 Done. All target ports are now free.');
} catch (err) {
	console.error('⚠️  Error during port cleanup:', err.message);
	process.exit(1);
}
