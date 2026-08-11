/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { execa } from 'execa';
import { platform } from 'node:os';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const buildDirName = 'built-dev';
const backendBuildDirName = 'built';
const logsDir = join(rootDir, 'logs', 'development');
const pidFilePath = join(logsDir, 'server.pid');
const logFilePath = join(logsDir, 'server.log');
const buildEntryPath = join(rootDir, 'packages', 'backend', backendBuildDirName, 'entry.js');
const compiledConfigPath = join(rootDir, buildDirName, '.config.json');

const devEnv = { ...process.env, MISSKEY_BUILD_DIR: 'built-dev', NODE_ENV: 'development' };

function log(message) {
	console.log(`[dev-server] ${message}`);
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
	log('Building development assets...');
	await execa('pnpm', ['dev:build'], {
		cwd: rootDir,
		stdio: 'inherit',
		env: devEnv,
	});
}

async function ensureDevConfigCompiled() {
	log('Compiling config for development...');
	await execa('pnpm', ['compile-config'], {
		cwd: join(rootDir, 'packages', 'backend'),
		stdio: 'inherit',
		env: devEnv,
	});
}

function readCompiledConfig() {
	if (!existsSync(compiledConfigPath)) {
		throw new Error(`Compiled configuration file not found: ${compiledConfigPath}`);
	}

	return JSON.parse(readFileSync(compiledConfigPath, 'utf8'));
}

function getCompiledConfigPort() {
	const config = readCompiledConfig();
	const port = Number(config.port);
	return Number.isFinite(port) ? port : 3000;
}

async function runStart() {
	if (!existsSync(buildEntryPath)) {
		log('Build output not found. Run `pnpm dev:build` first.');
		process.exit(1);
	}

	const existingPid = getPidFile();
	if (existingPid && isRunning(existingPid)) {
		log(`Dev instance already running with PID ${existingPid}. Use \`pnpm dev:stop\` before starting another one.`);
		process.exit(1);
	}

	await ensureDevConfigCompiled();

	log('Starting development server...');
	mkdirSync(logsDir, { recursive: true });
	const logFd = openSync(logFilePath, 'a');
	const child = execa('node', [`./${backendBuildDirName}/entry.js`], {
		cwd: join(rootDir, 'packages', 'backend'),
		detached: true,
		stdio: ['ignore', logFd, logFd],
		env: devEnv,
	});

	child.unref();
	writePid(child.pid);
	log(`Started development server with PID ${child.pid}.`);
	log(`Logs: ${logFilePath}`);
	log('Use `pnpm dev:status` to confirm and `pnpm dev:stop` to stop.');
}

async function runStop() {
	const isWindows = platform() === 'win32';

	const pid = getPidFile();
	if (!pid) {
		log('No development instance PID file found.');
		return;
	}
	if (!isRunning(pid)) {
		log(`PID ${pid} is not running. Cleaning stale PID file.`);
		removePidFile();
		return;
	}

	log(`Stopping development server PID ${pid} (entire process tree)...`);
	if (isWindows) {
		try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch {}
	} else {
		try { process.kill(-pid, 'SIGTERM'); } catch {}
		try { process.kill(pid, 'SIGTERM'); } catch {}
	}

	for (let i = 0; i < 20; i += 1) {
		if (!isRunning(pid)) {
			removePidFile();
			log('Development server stopped.');
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}

	// Force kill if still alive
	if (isWindows) {
		try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch {}
	} else {
		try { process.kill(-pid, 'SIGKILL'); } catch {}
		try { process.kill(pid, 'SIGKILL'); } catch {}
	}
	log('SIGTERM did not stop the process; SIGKILL sent.');

	removePidFile();
}

function runStatus() {
	const pid = getPidFile();
	if (!pid) {
		log('No development instance PID file found.');
		return;
	}

	log(`Development server PID ${pid} ${isRunning(pid) ? 'is running' : 'is not running'}.`);
}

async function runRestart() {
	await runStop();
	await runBuild();
	await runStart();
}

function runLogs(lines = 80) {
	if (!existsSync(logFilePath)) {
		log('No log file found. Start the server first with `pnpm dev:start`.');
		return;
	}

	const content = readFileSync(logFilePath, 'utf8');
	const allLines = content.split('\n');
	const tail = allLines.slice(-lines);
	console.log(tail.join('\n'));
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
		default:
			console.log('Usage: node scripts/dev-server.mjs <build|start|stop|restart|status|logs>');
			process.exit(1);
	}
}

await main();
