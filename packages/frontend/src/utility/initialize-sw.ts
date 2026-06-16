/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { lang } from '@@/js/config.js';

export async function initializeSw() {
	if (!('serviceWorker' in navigator)) return;

	try {
		await navigator.serviceWorker.register('/sw.js', { scope: '/', type: 'classic' });
		const registration = await navigator.serviceWorker.ready;
		console.log('[sw] ServiceWorker ready:', registration);
		registration.active?.postMessage({
			msg: 'initialize',
			lang,
		});
	} catch (err) {
		console.error('[sw] ServiceWorker registration failed:', err);
	}
}
