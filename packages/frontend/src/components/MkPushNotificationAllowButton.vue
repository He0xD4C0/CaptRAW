<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkButton
	v-if="supported && !pushRegistrationInServer"
	type="button"
	primary
	:gradate="gradate"
	:rounded="rounded"
	:inline="inline"
	:autofocus="autofocus"
	:wait="wait"
	:full="full"
	@click="subscribe"
>
	{{ i18n.ts.subscribePushNotification }}
</MkButton>
<MkButton
	v-else-if="!showOnlyToRegister && ($i ? pushRegistrationInServer : pushSubscription)"
	type="button"
	:primary="false"
	:gradate="gradate"
	:rounded="rounded"
	:inline="inline"
	:autofocus="autofocus"
	:wait="wait"
	:full="full"
	@click="unsubscribe"
>
	{{ i18n.ts.unsubscribePushNotification }}
</MkButton>
<MkButton v-else-if="$i && pushRegistrationInServer" disabled :rounded="rounded" :inline="inline" :wait="wait" :full="full">
	{{ i18n.ts.pushNotificationAlreadySubscribed }}
</MkButton>
<MkButton v-else-if="!supported" disabled :rounded="rounded" :inline="inline" :wait="wait" :full="full">
	{{ i18n.ts.pushNotificationNotSupported }}
</MkButton>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { instanceName } from '@@/js/config.js';
import { $i } from '@/i.js';
import MkButton from '@/components/MkButton.vue';
import { instance } from '@/instance.js';
import { apiWithDialog, promiseDialog, alert } from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { getAccounts } from '@/accounts.js';

defineProps<{
	primary?: boolean;
	gradate?: boolean;
	rounded?: boolean;
	inline?: boolean;
	link?: boolean;
	to?: string;
	autofocus?: boolean;
	wait?: boolean;
	danger?: boolean;
	full?: boolean;
	showOnlyToRegister?: boolean;
}>();

// ServiceWorker registration
const registration = ref<ServiceWorkerRegistration | undefined>();
// If this browser supports push notification
const supported = ref(false);
// If this browser has already subscribed to push notification
const pushSubscription = ref<PushSubscription | null>(null);
const pushRegistrationInServer = ref<{ state?: string; key?: string; userId: string; endpoint: string; sendReadMessage: boolean; } | undefined>();

const SUBSCRIBE_TIMEOUT_MS = 30000; // 30s timeout for push subscription

async function subscribe() {
	if (!registration.value || !supported.value || !instance.swPublickey) {
		console.warn('[push] Cannot subscribe — missing prereqs:', {
			registration: !!registration.value,
			supported: supported.value,
			swPublickey: !!instance.swPublickey,
		});
		return;
	}

	console.log('[push] Notification permission status:', Notification.permission);

	if ('Notification' in window) {
		let permission = Notification.permission;

		if (Notification.permission === 'default') {
			console.log('[push] Requesting notification permission...');
			permission = await promiseDialog(Notification.requestPermission(), null, null, i18n.ts.pleaseAllowPushNotification);
			console.log('[push] Permission result:', permission);
		}

		if (permission !== 'granted') {
			console.warn('[push] Permission not granted:', permission);
			alert({
				type: 'error',
				title: i18n.ts.browserPushNotificationDisabled,
				text: i18n.tsx.browserPushNotificationDisabledDescription({ serverName: instanceName }),
			});
			return;
		}
	}

	console.log('[push] Calling pushManager.subscribe() with VAPID key (first 20 chars):', instance.swPublickey.substring(0, 20) + '...');

	const subscribePromise = registration.value.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: urlBase64ToUint8Array(instance.swPublickey),
	});

	const timeoutPromise = new Promise<never>((_, reject) =>
		setTimeout(() => reject(new Error(`pushManager.subscribe() timed out after ${SUBSCRIBE_TIMEOUT_MS / 1000}s`)), SUBSCRIBE_TIMEOUT_MS)
	);

	// SEE: https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe#Parameters
	await promiseDialog(Promise.race([subscribePromise, timeoutPromise])
		.then(async subscription => {
			console.log('[push] pushManager.subscribe succeeded, endpoint:', subscription.endpoint);
			pushSubscription.value = subscription;

			// Register
			try {
				console.log('[push] Registering push subscription with server (sw/register)...');
				pushRegistrationInServer.value = await misskeyApi('sw/register', {
					endpoint: subscription.endpoint,
					auth: encode(subscription.getKey('auth')),
					publickey: encode(subscription.getKey('p256dh')),
				});
				console.log('[push] Server registration succeeded:', pushRegistrationInServer.value);
			} catch (apiErr) {
				console.error('[push] Server sw/register API failed:', apiErr);
				throw apiErr;
			}
		}, async err => { // When subscribe failed
			console.error('[push] pushManager.subscribe failed:', err?.name, err?.message, err);
			// 通知が許可されていなかったとき
			if (err?.name === 'NotAllowedError') {
				console.info('[push] User denied the notification permission request.');
				return;
			}

			// 違うapplicationServerKey (または gcm_sender_id)のサブスクリプションが
			// 既に存在していることが原因でエラーになった可能性があるので、
			// そのサブスクリプションを解除しておく
			// （これは実行されなさそうだけど、おまじない的に古い実装から残してある）
			console.log('[push] Attempting to clean up old push subscription...');
			await unsubscribe();
		}), null, null);
}

async function unsubscribe() {
	if (!pushSubscription.value) return;

	const endpoint = pushSubscription.value.endpoint;
	const accounts = await getAccounts();

	pushRegistrationInServer.value = undefined;

	if ($i && accounts.length >= 2) {
		apiWithDialog('sw/unregister', {
			endpoint,
		}, $i.token);
	} else {
		pushSubscription.value.unsubscribe();
		apiWithDialog('sw/unregister', {
			endpoint,
		}, null);
		pushSubscription.value = null;
	}
}

function encode(buffer: ArrayBuffer | null) {
	return btoa(String.fromCharCode(...(buffer != null ? new Uint8Array(buffer) : [])));
}

/**
 * Convert the URL safe base64 string to a Uint8Array
 * @param base64String base64 string
 */
function urlBase64ToUint8Array(base64String: string): BufferSource {
	const padding = '='.repeat((4 - base64String.length % 4) % 4);
	const base64 = (base64String + padding)
		.replace(/-/g, '+')
		.replace(/_/g, '/');

	const rawData = window.atob(base64);
	const outputArray = new Uint8Array(rawData.length);

	for (let i = 0; i < rawData.length; ++i) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}

if (navigator.serviceWorker == null) {
	// TODO: よしなに？
} else {
	navigator.serviceWorker.ready.then(async swr => {
		registration.value = swr;

		pushSubscription.value = await registration.value.pushManager.getSubscription();

		console.log('[push] Init — swPublickey:', !!instance.swPublickey, 'PushManager:', 'PushManager' in window, 'loggedIn:', !!($i && $i.token));

		if (instance.swPublickey && ('PushManager' in window) && $i && $i.token) {
			supported.value = true;

			if (pushSubscription.value) {
				console.log('[push] Existing push subscription found:', pushSubscription.value.endpoint);
				const res = await misskeyApi('sw/show-registration', {
					endpoint: pushSubscription.value.endpoint,
				});

				if (res) {
					pushRegistrationInServer.value = res;
				}
			}
		}
	});
}

defineExpose({
	pushRegistrationInServer: pushRegistrationInServer,
});
</script>
