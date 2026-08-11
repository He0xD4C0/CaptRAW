/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs';

const __dirname = import.meta.dirname;

const packageJsonPath = __dirname + '/../package.json'

function build() {
	try {
		const buildDir = process.env.MISSKEY_BUILD_DIR || (process.env.NODE_ENV === 'development' ? 'built-dev' : 'built');
		const json = fs.readFileSync(packageJsonPath, 'utf-8')
		const meta = JSON.parse(json);
		fs.mkdirSync(__dirname + '/../' + buildDir, { recursive: true });
		fs.writeFileSync(__dirname + '/../' + buildDir + '/meta.json', JSON.stringify({ version: meta.version }), 'utf-8');
	} catch (e) {
		console.error(e)
	}
}

build();

if (process.argv.includes("--watch")) {
	fs.watch(packageJsonPath, (event, filename) => {
		console.log(`update ${filename} ...`)
		build()
	})
}
