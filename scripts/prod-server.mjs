/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { execa } from 'execa';
import { platform } from 'node:os';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const logsDir = join(rootDir, 'logs', 'production');
const pidFilePath = join(logsDir, 'server.pid');
const supervisorPidFilePath = join(logsDir, 'supervisor.pid');
const logFilePath = join(logsDir, 'server.log');
const buildEntryPath = join(rootDir, 'packages', 'backend', 'built', 'entry.js');
const compiledConfigPath = join(rootDir, 'built', '.config.json');

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

async function ensureProductionConfigCompiled() {
	log('Compiling config for production...');
	await execa('pnpm', ['compile-config'], {
		cwd: join(rootDir, 'packages', 'backend'),
		stdio: 'inherit',
		env: { ...process.env, NODE_ENV: 'production' },
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
		log('Build output not found. Run `pnpm prod:build` or `pnpm prod:restart` first.');
		process.exit(1);
	}

	const existingPid = getPidFile();
	if (existingPid && isRunning(existingPid)) {
		log(`Instance already running with PID ${existingPid}. Use \`pnpm prod:stop\` before starting another one.`);
		process.exit(1);
	}

	await ensureProductionConfigCompiled();

	log('Starting production server...');
	mkdirSync(logsDir, { recursive: true });
	const logFd = openSync(logFilePath, 'a');
	const child = execa('node', ['--tls-keylog=C:\\temp\\tls-keys.log', './built/entry.js'], {
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
	const isWindows = platform() === 'win32';

	// Kill supervisor process first
	const supervisorPid = existsSync(supervisorPidFilePath)
		? Number(readFileSync(supervisorPidFilePath, 'utf8').trim())
		: null;
	if (supervisorPid && !isNaN(supervisorPid) && isRunning(supervisorPid)) {
		log(`Stopping supervisor PID ${supervisorPid}...`);
		if (isWindows) {
			try { execSync(`taskkill /F /T /PID ${supervisorPid}`, { stdio: 'ignore' }); } catch {}
		} else {
			try { process.kill(-supervisorPid, 'SIGTERM'); } catch {}
			try { process.kill(supervisorPid, 'SIGTERM'); } catch {}
		}
		if (existsSync(supervisorPidFilePath)) unlinkSync(supervisorPidFilePath);
	}

	// Kill the server process tree
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

	log(`Stopping production server PID ${pid} (entire process tree)...`);
	if (isWindows) {
		try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch {}
	} else {
		try { process.kill(-pid, 'SIGTERM'); } catch {}
		try { process.kill(pid, 'SIGTERM'); } catch {}
	}

	for (let i = 0; i < 20; i += 1) {
		if (!isRunning(pid)) {
			removePidFile();
			log('Production server stopped.');
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

function normalizePathForCommandLine(value) {
	return value.replace(/\\/g, '\\\\').toLowerCase();
}

function getProductionEntryProcesses() {
	const isWindows = platform() === 'win32';
	const entryPath = join(rootDir, 'packages', 'backend', 'built', 'entry.js');
	const entryPathNeedle = normalizePathForCommandLine(entryPath);
	const relativeNeedle = normalizePathForCommandLine('\\packages\\backend\\built\\entry.js');
	const directNeedle = normalizePathForCommandLine('\\built\\entry.js');

	try {
		if (isWindows) {
			const output = execFileSync('powershell.exe', [
				'-NoProfile',
				'-Command',
				'Get-CimInstance Win32_Process -Filter "name = \'node.exe\'" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress',
			], { encoding: 'utf8' }).trim();

			if (output === '') return [];
			const parsed = JSON.parse(output);
			const processes = Array.isArray(parsed) ? parsed : [parsed];

			return processes
				.filter((process) => {
					const commandLine = normalizePathForCommandLine(process.CommandLine ?? '');
					return commandLine.includes(entryPathNeedle) ||
						commandLine.includes(relativeNeedle) ||
						(commandLine.includes(directNeedle) && commandLine.includes('--tls-keylog'));
				})
				.map((process) => ({
					pid: Number(process.ProcessId),
					parentPid: Number(process.ParentProcessId),
					commandLine: process.CommandLine ?? '',
				}));
		}

		const output = execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' });
		return output
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
				if (!match) return null;
				return { pid: Number(match[1]), parentPid: Number(match[2]), commandLine: match[3] };
			})
			.filter((process) => process != null)
			.filter((process) => {
				const commandLine = normalizePathForCommandLine(process.commandLine);
				return commandLine.includes(entryPathNeedle) || commandLine.includes('packages/backend/built/entry.js') || commandLine.includes('./built/entry.js');
			});
	} catch (err) {
		log(`Could not enumerate node processes: ${err.message}`);
		return [];
	}
}

function formatTrackedFlag(process, trackedPid, supervisorPid) {
	const flags = [];
	if (process.pid === trackedPid) flags.push('pid-file');
	if (process.pid === supervisorPid) flags.push('supervisor');
	if (process.parentPid === trackedPid) flags.push('child-of-pid-file');
	if (process.parentPid === supervisorPid) flags.push('child-of-supervisor');
	return flags.length > 0 ? flags.join(', ') : 'extra/untracked';
}

function runStatus() {
	const pid = getPidFile();
	const supervisorPid = existsSync(supervisorPidFilePath)
		? Number(readFileSync(supervisorPidFilePath, 'utf8').trim())
		: null;

	if (!pid) {
		log('No production instance PID file found.');
	} else {
		log(`Production server PID file: ${pid} (${isRunning(pid) ? 'running' : 'not running'}).`);
	}

	if (supervisorPid && !Number.isNaN(supervisorPid)) {
		log(`Supervisor PID file: ${supervisorPid} (${isRunning(supervisorPid) ? 'running' : 'not running'}).`);
	}

	const processes = getProductionEntryProcesses();
	if (processes.length === 0) {
		log('No running production backend entry.js processes found.');
		return;
	}

	log(`Detected ${processes.length} production backend entry.js process(es):`);
	for (const process of processes.sort((a, b) => a.pid - b.pid)) {
		const flag = formatTrackedFlag(process, pid, supervisorPid);
		log(`- PID ${process.pid} (PPID ${process.parentPid}) [${flag}] ${process.commandLine}`);
	}

	const extraProcesses = processes.filter((process) => formatTrackedFlag(process, pid, supervisorPid) === 'extra/untracked');
	if (extraProcesses.length > 0) {
		log(`WARNING: ${extraProcesses.length} extra/untracked production backend process(es) detected.`);
	}
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

	execSync(`start cmd.exe /k "title CaptRAW Production Logs && powershell -Command Get-Content -Path '${logFilePath}' -Wait -Tail 80"`, {
		stdio: 'ignore',
	});
	log('Opened log viewer in a new window.');
}

function runSupervise() {
	const scriptPath = join(rootDir, 'scripts', 'prod-server.mjs');
	const isWindows = platform() === 'win32';

	mkdirSync(logsDir, { recursive: true });

	if (isWindows) {
		// Write a .bat launcher to avoid all quoting/escaping issues with spaces in paths
		const batPath = join(logsDir, 'supervisor-launcher.bat');
		writeFileSync(batPath, [
			'@echo off',
			`cd /d "${rootDir}"`,
			'title CaptRAW Production Supervisor',
			`node "${scriptPath}" supervisor`,
		].join('\r\n'), 'utf8');

		// Use PowerShell Start-Process — handles paths with spaces natively
		const child = spawn('powershell.exe', [
			'-NoProfile', '-Command',
			`Start-Process -FilePath '${batPath.replace(/'/g, "''")}' -WindowStyle Normal`,
		], {
			detached: true,
			stdio: 'ignore',
		});
		child.unref();
		// Track supervisor process PID
		writeFileSync(supervisorPidFilePath, String(child.pid), 'utf8');
	} else {
		const child = spawn('node', [scriptPath, 'supervisor'], {
			detached: true,
			stdio: 'ignore',
		});
		child.unref();
		writeFileSync(supervisorPidFilePath, String(child.pid), 'utf8');
	}

	log('Supervisor launched in a detached window (PID-independent).');
	log('It will survive VS Code closure. Check `pnpm prod:status` or the new terminal window.');
}

// ── Watchdog Supervisor ──────────────────────────────────
const HEALTHZ_PORT = () => {
	try {
		return getCompiledConfigPort();
	} catch {
		return 3000;
	}
};

const MAX_RESTARTS = 10;
const RESTART_WINDOW_MS = 60_000;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 30_000;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 10_000;

async function initDatabase() {
	await ensureProductionConfigCompiled();
	const config = readCompiledConfig();
	const dbConfig = config.db ?? {};
	const host = dbConfig.host ?? '127.0.0.1';
	const port = Number(dbConfig.port ?? 5432);
	const user = dbConfig.user ?? 'misskey';
	const password = dbConfig.pass ?? process.env.PG_PASSWORD ?? 'misskey';
	const database = dbConfig.db ?? 'misskey';

	log('Waiting for PostgreSQL...');
	const backendRequire = createRequire(join(rootDir, 'packages', 'backend', 'package.json'));
	const { Client } = backendRequire('pg');
	const maxRetries = 30;
	for (let i = 0; i < maxRetries; i++) {
		const client = new Client({
			host,
			port,
			user,
			password,
			database,
			connectionTimeoutMillis: 3000,
		});
		try {
			await client.connect();
			await client.query('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');
			await client.query('CREATE EXTENSION IF NOT EXISTS "unaccent"');
			await client.end();
			log('Database extensions ready.');
			return;
		} catch (err) {
			try { await client.end(); } catch {}
			if (i === maxRetries - 1) {
				log(`Database init failed after ${maxRetries} attempts: ${err.message}`);
				return;
			}
			await new Promise(r => setTimeout(r, 3000));
		}
	}
}

async function runSupervisor() {
	if (!existsSync(buildEntryPath)) {
		log('Build output not found. Run `pnpm prod:build` or `pnpm prod:restart` first.');
		process.exit(1);
	}

	await ensureProductionConfigCompiled();

	// Prevent duplicate supervisor
	const existingPid = getPidFile();
	if (existingPid && isRunning(existingPid)) {
		log(`Instance already running with PID ${existingPid}. Stop it first with \`pnpm prod:stop\`.`);
		process.exit(1);
	}

	let shuttingDown = false;
	let restartCount = 0;
	let restartWindowStart = Date.now();
	let currentChild = null;
	let healthTimer = null;

	function killProcessTree(child) {
		if (!child || child.killed) return;
		const pid = child.pid;
		if (platform() === 'win32') {
			try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch {}
		} else {
			try { process.kill(-pid, 'SIGTERM'); } catch {}
			try { child.kill('SIGTERM'); } catch {}
		}
	}

	function cleanup() {
		shuttingDown = true;
		if (healthTimer) clearInterval(healthTimer);
		killProcessTree(currentChild);
		removePidFile();
		log('Supervisor shut down.');
		process.exit(0);
	}

	process.on('SIGTERM', cleanup);
	process.on('SIGINT', cleanup);

	log('Supervisor started. Monitoring production server...');
	await initDatabase();
	log(`Max restarts: ${MAX_RESTARTS} per ${RESTART_WINDOW_MS / 1000}s window`);

	while (!shuttingDown) {
		// Reset restart window
		if (Date.now() - restartWindowStart > RESTART_WINDOW_MS) {
			restartCount = 0;
			restartWindowStart = Date.now();
		}

		if (restartCount >= MAX_RESTARTS) {
			log(`FATAL: Exceeded ${MAX_RESTARTS} restarts in ${RESTART_WINDOW_MS / 1000}s. Giving up.`);
			log('Fix the underlying issue and restart manually with `pnpm prod:start`.');
			cleanup();
		}

		// Compile config and spawn
		log('Refreshing compiled config...');
		try {
			await ensureProductionConfigCompiled();
		} catch {
			log('Config compilation failed. Retrying in 10s...');
			await new Promise(r => setTimeout(r, 10_000));
			continue;
		}

		log(`Starting server (attempt ${restartCount + 1})...`);

		try {
			currentChild = execa('node', ['./built/entry.js'], {
				cwd: join(rootDir, 'packages', 'backend'),
				stdio: ['ignore', 'pipe', 'pipe'],
				env: { ...process.env, NODE_ENV: 'production' },
			});

			// Tee: pipe child stdout/stderr to both terminal and log file
			const logStream = (await import('node:fs')).createWriteStream(logFilePath, { flags: 'a' });
			currentChild.stdout?.pipe(process.stdout);
			currentChild.stdout?.pipe(logStream);
			currentChild.stderr?.pipe(process.stderr);
			currentChild.stderr?.pipe(logStream);
		} catch (err) {
			log(`Failed to spawn: ${err.message}`);
			restartCount++;
			const backoff = Math.min(BACKOFF_BASE_MS * (2 ** restartCount), BACKOFF_MAX_MS);
			await new Promise(r => setTimeout(r, backoff));
			continue;
		}

		writePid(currentChild.pid);
		log(`Server started with PID ${currentChild.pid}.`);

		// Start health check polling
		const port = HEALTHZ_PORT();
		if (healthTimer) clearInterval(healthTimer);
		healthTimer = setInterval(async () => {
			if (shuttingDown || !currentChild || currentChild.killed) return;
			try {
				const resp = await fetch(`http://127.0.0.1:${port}/healthz`, {
					signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
				});
				if (!resp.ok) {
					log(`⚠️  Health check returned ${resp.status}`);
				}
			} catch {
				log('⚠️  Health check failed (unreachable)');
			}
		}, HEALTH_CHECK_INTERVAL_MS);

		// Wait for exit
		try {
			const result = await currentChild;
			if (healthTimer) clearInterval(healthTimer);
			removePidFile();

			if (shuttingDown) break;

			log(`Server exited with code ${result.exitCode}.`);
		} catch (err) {
			if (healthTimer) clearInterval(healthTimer);
			removePidFile();

			if (shuttingDown) break;

			log(`Server crashed: ${err.message}`);
		}

		restartCount++;
		const backoff = Math.min(BACKOFF_BASE_MS * (2 ** restartCount), BACKOFF_MAX_MS);
		log(`Restarting in ${(backoff / 1000).toFixed(1)}s... (attempt ${restartCount}/${MAX_RESTARTS})`);
		await new Promise(r => setTimeout(r, backoff));
	}
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
		case 'supervisor':
			await runSupervisor();
			break;
		default:
			console.log('Usage: node scripts/prod-server.mjs <build|start|stop|restart|status|logs|logs-window|supervisor>');
			process.exit(1);
	}
}

await main();
