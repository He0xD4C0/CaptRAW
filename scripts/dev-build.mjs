/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
// MISSKEY_BUILD_DIR controls output location without changing build behavior.
// The build itself runs in production mode (minified, _DEV_: false) — same as prod.
const buildEnv = { ...process.env, MISSKEY_BUILD_DIR: 'built-dev' };

console.log('[dev-build] Building development assets into built-dev/...');

// Step 1: Clean dev output (now safe — only wipes built-dev/ + package built/ dirs)
await execa('pnpm', ['clean'], { cwd: rootDir, stdio: 'inherit', env: buildEnv });

// Step 2: Build all packages (same as production pipeline, outputs to built-dev/)
await execa('pnpm', ['build-pre'], { cwd: rootDir, stdio: 'inherit', env: buildEnv });
await execa('pnpm', ['-r', 'build'], { cwd: rootDir, stdio: 'inherit', env: buildEnv });
await execa('pnpm', ['build-assets'], { cwd: rootDir, stdio: 'inherit', env: buildEnv });

console.log('[dev-build] Development build complete. Use pnpm dev:start to launch.');
