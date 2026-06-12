<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps_m">
	<MkFolder>
		<template #icon><i class="ti ti-phone"></i></template>
		<template #label>Phone Number</template>

		<div class="_gaps_m">
			<MkInput v-model="phone" :disabled="!instance.enableSms" type="text">
				<template #prefix><i class="ti ti-phone"></i></template>
				<template #label>Phone Number</template>
				<template #caption>E.164 format (e.g. +8613800138000)</template>
			</MkInput>

			<div v-if="phoneChanged" class="_gaps_m">
				<MkInput v-model="verifyCode" type="text" :maxlength="6">
					<template #label>Verification Code</template>
					<template #caption>Enter the 6-digit code sent to your phone</template>
				</MkInput>
				<MkButton primary :disabled="!canVerify" @click="verify">Verify</MkButton>
			</div>

			<MkButton v-if="!phoneChanged && phone != null && phone !== ''" @click="savePhone">Update Phone</MkButton>
			<MkButton v-if="!phoneChanged && (phone == null || phone === '')" :disabled="phone === ''" @click="savePhone">Send Code</MkButton>
			<MkButton v-if="phoneChanged" @click="cancelEdit">{{ i18n.ts.cancel }}</MkButton>

			<div v-if="phone != null && phone !== '' && phoneVerified" style="color: var(--success);">
				<i class="ti ti-check"></i> Verified
			</div>
			<div v-else-if="phone != null && phone !== ''" style="color: var(--warn);">
				<i class="ti ti-alert-triangle"></i> Not verified
			</div>
		</div>
	</MkFolder>
</div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { instance } from '@/instance.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';

const currentPhone = ref('');
const phone = ref('');
const phoneVerified = ref(false);
const verifyCode = ref('');

onMounted(async () => {
	const me = await misskeyApi('i', {});
	currentPhone.value = me.phone ?? '';
	phone.value = me.phone ?? '';
	phoneVerified.value = me.phoneVerified ?? false;
});

const phoneChanged = computed(() => phone.value !== currentPhone.value && phone.value !== '');
const canVerify = computed(() => verifyCode.value.length === 6);

async function savePhone() {
	if (phone.value === currentPhone.value) return;
	await os.apiWithDialog('i/update-phone', { phone: phone.value });
	currentPhone.value = phone.value;
}

async function cancelEdit() {
	phone.value = currentPhone.value;
	verifyCode.value = '';
}

async function verify() {
	await os.apiWithDialog('phone/verify-code', { phone: phone.value, code: verifyCode.value });
	phoneVerified.value = true;
	currentPhone.value = phone.value;
	verifyCode.value = '';
}

definePage(() => ({
	title: 'Phone',
	icon: 'ti ti-phone',
}));
</script>
