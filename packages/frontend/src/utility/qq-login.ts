/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export interface QqLoginResult {
	id: string;
	token: string;
}

interface QqLoginMessage {
	type: 'qq-login';
	id: string;
	token: string;
}

let activeLogin: Promise<QqLoginResult | null> | null = null;

function isQqLoginMessage(value: unknown): value is QqLoginMessage {
	if (typeof value !== 'object' || value == null) return false;
	const message = value as Partial<QqLoginMessage>;
	return message.type === 'qq-login' && typeof message.id === 'string' && typeof message.token === 'string';
}

export function openQqLogin(): Promise<QqLoginResult | null> {
	if (activeLogin != null) return Promise.resolve(null);

	const width = 600;
	const height = 700;
	const left = window.screenX + (window.outerWidth - width) / 2;
	const top = window.screenY + (window.outerHeight - height) / 2;
	const popup = window.open('/api/qq/auth', 'qqLogin', `width=${width},height=${height},left=${left},top=${top}`);

	if (popup == null) return Promise.resolve(null);

	activeLogin = new Promise((resolve) => {
		let closeWatcher: number | null = null;

		const cleanup = () => {
			window.removeEventListener('message', onMessage);
			if (closeWatcher != null) {
				window.clearInterval(closeWatcher);
				closeWatcher = null;
			}
			activeLogin = null;
		};

		const finish = (result: QqLoginResult | null) => {
			cleanup();
			resolve(result);
		};

		const onMessage = (event: MessageEvent) => {
			if (event.origin !== window.location.origin || event.source !== popup) return;
			if (!isQqLoginMessage(event.data)) return;
			finish({ id: event.data.id, token: event.data.token });
		};

		// PWA fallback: when the popup closes (Chrome Custom Tab dismissed),
		// check for qq_temp_token / qq_temp_id cookies set by the backend.
		const consumeCookie = (): QqLoginResult | null => {
			const tokenMatch = document.cookie.match(/(?:^|;\s*)qq_temp_token=([^;]*)/);
			const idMatch = document.cookie.match(/(?:^|;\s*)qq_temp_id=([^;]*)/);
			if (!tokenMatch) return null;
			const token = decodeURIComponent(tokenMatch[1]);
			const id = idMatch ? decodeURIComponent(idMatch[1]) : '';
			document.cookie = 'qq_temp_token=; Path=/; Max-Age=0; SameSite=Lax';
			document.cookie = 'qq_temp_id=; Path=/; Max-Age=0; SameSite=Lax';
			return { id, token };
		};

		window.addEventListener('message', onMessage);
		closeWatcher = window.setInterval(() => {
			if (!popup.closed) return;
			const cookieResult = consumeCookie();
			finish(cookieResult);
		}, 500);
	});

	return activeLogin;
}
