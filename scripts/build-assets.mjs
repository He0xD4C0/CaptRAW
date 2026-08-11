/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { buildTarball } from './tarball.mjs';

const configDir = fileURLToPath(new URL('../.config', import.meta.url));
const configPath = process.env.MISSKEY_CONFIG_YML
	? path.resolve(configDir, process.env.MISSKEY_CONFIG_YML)
	: process.env.NODE_ENV === 'development'
		? path.resolve(configDir, 'dev.yml')
		: process.env.NODE_ENV === 'test'
			? path.resolve(configDir, 'test.yml')
			: path.resolve(configDir, 'default.yml');

async function loadConfig() {
	return fs.readFile(configPath, 'utf-8').then(data => yaml.load(data)).catch(() => null);
}

async function copyFrontendFonts() {
	const buildDir = process.env.MISSKEY_BUILD_DIR || (process.env.NODE_ENV === 'development' ? 'built-dev' : 'built');
	await fs.cp('./packages/frontend/node_modules/three/examples/fonts', `./${buildDir}/_frontend_dist_/fonts`, { dereference: true, recursive: true });
}

async function build() {
	await Promise.all([
		copyFrontendFonts(),
		loadConfig().then(config => config?.publishTarballInsteadOfProvideRepositoryUrl && buildTarball()),
	]);
}

await build();
