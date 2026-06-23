/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const pg = require('pg');
const fs = require('fs');
const path = require('path');

const cfgPath = path.join(__dirname, '..', '..', '..', '..', 'built', '.config.json');
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
		console.log('systemAccount rows:', JSON.stringify(r1.rows, null, 2));

		const userIds = r1.rows.map(r => r.userId);
		const r2 = await c.query('SELECT id, username, host FROM "user" WHERE id = ANY($1)', [userIds]);
		console.log('system user details:', JSON.stringify(r2.rows, null, 2));

		const r3 = await c.query('SELECT "rootUserId" FROM "meta" LIMIT 1');
		console.log('meta rootUserId:', JSON.stringify(r3.rows, null, 2));

		// Check if proxy user has a profile
		const proxyUserId = r1.rows.find(r => r.type === 'proxy')?.userId;
		if (proxyUserId) {
			const r4 = await c.query('SELECT "userId", password FROM "user_profile" WHERE "userId" = $1', [proxyUserId]);
			console.log('proxy profile:', JSON.stringify(r4.rows, null, 2));
		}
	} catch (e) {
		console.error('Query error:', e.message);
	} finally {
		await c.end();
	}
})();
