/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const fs = require('fs');
const path = require('path');
const pg = require('pg');

const cfgPath = path.join(__dirname, '..', 'built', '.config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

const c = new pg.Client({
	host: cfg.db.host,
	port: cfg.db.port,
	database: cfg.db.db,
	user: cfg.db.user,
	password: cfg.db.pass,
});

(async () => {
	await c.connect();
	try {
		const r1 = await c.query('SELECT id, type, "userId" FROM "system_account"');
		console.log('system_account rows:', JSON.stringify(r1.rows, null, 2));

		const r2 = await c.query(`SELECT id, username, host FROM "user" WHERE username LIKE 'system.%'`);
		console.log('system users:', JSON.stringify(r2.rows, null, 2));

		const r3 = await c.query(`SELECT "rootUserId" FROM "meta" LIMIT 1`);
		console.log('meta rootUserId:', JSON.stringify(r3.rows, null, 2));
	} finally {
		await c.end();
	}
})();
