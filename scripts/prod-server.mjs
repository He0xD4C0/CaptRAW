/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { execa } from 'execa';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const pidFilePath = join(rootDir, 'built', 'prod-server.pid');
const logFilePath = join(rootDir, 'built', 'prod-server.log');
const buildEntryPath = join(rootDir, 'packages', 'backend', 'built', 'entry.js');

function log(message) {
	console.log(`[prod-server] ${message}`);
}

function getPidFile() {
	if (!existsSync(pidFilePath)) {
		return null;
	}

	const content = readFileSync(pidFilePath, 'utf8').trim();
	const pid = Number(content);
	return Number.isNaN(pid) ? null : pid;
}

function isRunning(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function writePid(pid) {
	mkdirSync(dirname(pidFilePath), { recursive: true });
	writeFileSync(pidFilePath, String(pid), 'utf8');
}

function removePidFile() {
	if (existsSync(pidFilePath)) {
		unlinkSync(pidFilePath);
	}
}

async function runBuild() {
	log('Building production assets...');
	await execa('pnpm', ['build'], {
		cwd: rootDir,
		stdio: 'inherit',
		env: { ...process.env, NODE_ENV: 'production' },
	});
}

async function runStart() {
	if (!existsSync(buildEntryPath)) {
		log('Build output not found. Run `pnpm prod:build` or `pnpm prod:restart` first.');
		process.exit(1);
	}

	const existingPid = getPidFile();
	if (existingPid && isRunning(existingPid)) {
		log(`Instance already running with PID ${existingPid}. Use \`pnpm prod:stop\` before starting another one.`);
		process.exit(1);
	}

	log('Compiling config for production...');
	await execa('pnpm', ['compile-config'], {
		cwd: join(rootDir, 'packages', 'backend'),
		stdio: 'inherit',
		env: { ...process.env, NODE_ENV: 'production' },
	});

	log('Starting production server...');
	const logFd = openSync(logFilePath, 'a');
	const child = execa('node', ['./built/entry.js'], {
		cwd: join(rootDir, 'packages', 'backend'),
		detached: true,
		stdio: ['ignore', logFd, logFd],
		env: { ...process.env, NODE_ENV: 'production' },
	});

	child.unref();
	writePid(child.pid);
	log(`Started production server with PID ${child.pid}.`);
	log(`Logs: ${logFilePath}`);
	log('Use `pnpm prod:status` to confirm and `pnpm prod:stop` to stop.');
}

async function runStop() {
	const pid = getPidFile();
	if (!pid) {
		log('No production instance PID file found.');
		return;
	}
	if (!isRunning(pid)) {
		log(`PID ${pid} is not running. Cleaning stale PID file.`);
		removePidFile();
		return;
	}

	log(`Stopping production server PID ${pid}...`);
	try {
		process.kill(pid, 'SIGTERM');
	} catch {
		// Continue to fallback kill
	}

	for (let i = 0; i < 20; i += 1) {
		if (!isRunning(pid)) {
			removePidFile();
			log('Production server stopped.');
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}

	try {
		process.kill(pid, 'SIGKILL');
		log('SIGTERM did not stop the process; SIGKILL sent.');
	} catch {
		log('Could not send SIGKILL to the process.');
	}

	removePidFile();
}

function runStatus() {
	const pid = getPidFile();
	if (!pid) {
		log('No production instance PID file found.');
		return;
	}

	log(`Production server PID ${pid} ${isRunning(pid) ? 'is running' : 'is not running'}.`);
}

async function runRestart() {
	await runStop();
	await runBuild();
	await runStart();
}

function runLogs(lines = 80) {
	if (!existsSync(logFilePath)) {
		log('No log file found. Start the server first with `pnpm prod:start`.');
		return;
	}

	const content = readFileSync(logFilePath, 'utf8');
	const allLines = content.split('\n');
	const tail = allLines.slice(-lines);
	console.log(tail.join('\n'));
}

function runLogsWindow() {
	if (!existsSync(logFilePath)) {
		log('No log file found. Start the server first with `pnpm prod:start`.');
		return;
	}

	execSync(`start cmd.exe /k "title Misskey Production Logs && powershell -Command Get-Content -Path '${logFilePath}' -Wait -Tail 80"`, {
		stdio: 'ignore',
	});
	log('Opened log viewer in a new window.');
}

async function main() {
	const [command] = process.argv.slice(2);
	switch (command) {
		case 'build':
			await runBuild();
			break;
		case 'start':
			await runStart();
			break;
		case 'stop':
			await runStop();
			break;
		case 'restart':
			await runRestart();
			break;
		case 'status':
			runStatus();
			break;
		case 'logs':
			runLogs();
			break;
		case 'logs-window':
			runLogsWindow();
			break;
		default:
			console.log('Usage: node scripts/prod-server.mjs <build|start|stop|restart|status|logs|logs-window>');
			process.exit(1);
	}
}

await main();
