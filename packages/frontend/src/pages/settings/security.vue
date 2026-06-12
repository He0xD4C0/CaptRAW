<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<SearchMarker path="/settings/security" :label="i18n.ts.security" :keywords="['security']" icon="ti ti-lock" :inlining="['2fa']">
	<div class="_gaps_m">
		<MkFeatureBanner icon="/client-assets/locked_with_key_3d.png" color="#ffbf00">
			<SearchText>{{ i18n.ts._settings.securityBanner }}</SearchText>
		</MkFeatureBanner>

		<SearchMarker :keywords="['password']">
			<FormSection first>
				<template #label><SearchLabel>{{ i18n.ts.password }}</SearchLabel></template>

				<SearchMarker>
					<MkButton primary @click="change()">
						<SearchLabel>{{ i18n.ts.changePassword }}</SearchLabel>
					</MkButton>
				</SearchMarker>
			</FormSection>
		</SearchMarker>

		<X2fa/>

		<SearchMarker :keywords="['phone', 'sms', 'mobile']">
			<FormSection>
				<template #label><SearchLabel>Phone Number</SearchLabel></template>

				<MkInput v-model="phone" :disabled="!instance.enableSms" type="text">
					<template #prefix><i class="ti ti-phone"></i></template>
					<template #label>Phone Number</template>
					<template #caption>E.164 format (e.g. +8613800138000)</template>
				</MkInput>

				<div class="phone-row">
					<MkInput v-model="verifyCode" type="text" :maxlength="6" class="phone-input">
						<template #label>Verification Code</template>
					</MkInput>
					<MkButton :disabled="phone === '' || sending" class="send-btn" @click="sendCode">
						<i v-if="sending" class="ti ti-loader animate-pulse"></i>
						<span v-else>{{ codeSent ? 'Resend' : 'Send Code' }}</span>
					</MkButton>
				</div>
				<div class="phone-caption">Enter the 6-digit code sent to your phone</div>

				<MkButton primary :disabled="verifyCode.length !== 6 || verifying" @click="verify">
					<i v-if="verifying" class="ti ti-loader animate-pulse"></i>
					<span v-else>Verify</span>
				</MkButton>

					<div v-if="phoneVerified" style="color: var(--MI_THEME-success);">
						<i class="ti ti-check"></i> Phone number verified and bound to your account
					</div>
					<div v-else-if="codeSent" style="color: var(--MI_THEME-warn);">
						<i class="ti ti-clock"></i> Verification code sent. Please check your phone.
					</div>
				</FormSection>
		</SearchMarker>

		<SearchMarker :keywords="['signin', 'login', 'history', 'log']">
			<FormSection>
				<template #label><SearchLabel>{{ i18n.ts.signinHistory }}</SearchLabel></template>
				<MkPagination :paginator="paginator" withControl :forceDisableInfiniteScroll="true">
					<template #default="{items}">
						<div>
							<div v-for="item in items" :key="item.id" v-panel class="timnmucd">
								<header>
									<i v-if="item.success" class="ti ti-check icon succ"></i>
									<i v-else class="ti ti-circle-x icon fail"></i>
									<code class="ip _monospace">{{ item.ip }}</code>
									<MkTime :time="item.createdAt" class="time"/>
								</header>
							</div>
						</div>
					</template>
				</MkPagination>
			</FormSection>
		</SearchMarker>

		<SearchMarker :keywords="['regenerate', 'refresh', 'reset', 'token']">
			<FormSection>
				<FormSlot>
					<MkButton danger @click="regenerateToken"><i class="ti ti-refresh"></i> <SearchLabel>{{ i18n.ts.regenerateLoginToken }}</SearchLabel></MkButton>
					<template #caption>{{ i18n.ts.regenerateLoginTokenDescription }}</template>
				</FormSlot>
			</FormSection>
		</SearchMarker>
	</div>
</SearchMarker>
</template>

<script lang="ts" setup>
import { computed, markRaw, ref, onMounted } from 'vue';
import X2fa from './2fa.vue';
import FormSection from '@/components/form/section.vue';
import FormSlot from '@/components/form/slot.vue';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import MkPagination from '@/components/MkPagination.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import MkFeatureBanner from '@/components/MkFeatureBanner.vue';
import { Paginator } from '@/utility/paginator.js';
import { instance } from '@/instance.js';

const paginator = markRaw(new Paginator('i/signin-history', {
	limit: 5,
}));

async function change() {
	const { canceled: canceled2, result: newPassword } = await os.inputText({
		title: i18n.ts.newPassword,
		type: 'password',
		autocomplete: 'new-password',
	});
	if (canceled2 || newPassword == null) return;

	const { canceled: canceled3, result: newPassword2 } = await os.inputText({
		title: i18n.ts.newPasswordRetype,
		type: 'password',
		autocomplete: 'new-password',
	});
	if (canceled3 || newPassword2 == null) return;

	if (newPassword !== newPassword2) {
		os.alert({
			type: 'error',
			text: i18n.ts.retypedNotMatch,
		});
		return;
	}

	const auth = await os.authenticateDialog();
	if (auth.canceled) return;

	os.apiWithDialog('i/change-password', {
		currentPassword: auth.result.password,
		token: auth.result.token,
		newPassword,
	});
}

async function regenerateToken() {
	const auth = await os.authenticateDialog();
	if (auth.canceled) return;

	misskeyApi('i/regenerate-token', {
		password: auth.result.password,
		token: auth.result.token,
	});
}

// Phone number
const phone = ref('');
const phoneVerified = ref(false);
const verifyCode = ref('');
const codeSent = ref(false);
const sending = ref(false);
const verifying = ref(false);

onMounted(async () => {
	const me = await misskeyApi('i', {});
	phone.value = me.phone ?? '';
	phoneVerified.value = me.phoneVerified ?? false;
});

async function sendCode() {
	sending.value = true;
	try {
		await os.apiWithDialog('i/update-phone', { phone: phone.value });
		codeSent.value = true;
		verifyCode.value = '';
	} finally {
		sending.value = false;
	}
}

async function verify() {
	verifying.value = true;
	try {
		await os.apiWithDialog('phone/verify-code', { phone: phone.value, code: verifyCode.value });
		phoneVerified.value = true;
		codeSent.value = false;
		verifyCode.value = '';
	} finally {
		verifying.value = false;
	}
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts.security,
	icon: 'ti ti-lock',
}));
</script>

<style lang="scss" scoped>
.phone-row {
	display: flex;
	align-items: center;
	gap: 8px;
}
.phone-input {
	flex: 1 1 auto;
	min-width: 0;
}
.send-btn {
	flex-shrink: 0;
	align-self: flex-end;
	white-space: nowrap;
}
.phone-caption {
	font-size: 0.85em;
	color: var(--MI_THEME-fgTransparentWeak);
	margin-top: 4px;
}
.animate-pulse {
	animation: pulse 1s infinite;
}
@keyframes pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.5; }
}
.timnmucd {
	padding: 12px;

	&:first-child {
		border-top-left-radius: 6px;
		border-top-right-radius: 6px;
	}

	&:last-child {
		border-bottom-left-radius: 6px;
		border-bottom-right-radius: 6px;
	}

	&:not(:last-child) {
		border-bottom: solid 0.5px var(--MI_THEME-divider);
	}

	> header {
		display: flex;
		align-items: center;

		> .icon {
			width: 1em;
			margin-right: 0.75em;

			&.succ {
				color: var(--MI_THEME-success);
			}

			&.fail {
				color: var(--MI_THEME-error);
			}
		}

		> .ip {
			flex: 1;
			min-width: 0;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			margin-right: 12px;
		}

		> .time {
			margin-left: auto;
			opacity: 0.7;
		}
	}
}
</style>
