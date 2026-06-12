<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<SearchMarker path="/admin/sms-settings" label="SMS" :keywords="['sms', 'phone', 'alibaba', 'verification']" icon="ti ti-phone">
			<div class="_gaps_m">
				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #icon><i class="ti ti-settings"></i></template>
						<template #label><SearchLabel>SMS Provider</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSwitch v-model="enableSms">
									<template #label><SearchLabel>Enable SMS</SearchLabel></template>
									<template #caption>Enable SMS verification for signup and login</template>
								</MkSwitch>
							</SearchMarker>

							<SearchMarker>
								<MkSwitch v-model="phoneRequiredForSignup">
									<template #label><SearchLabel>Require phone for signup</SearchLabel></template>
									<template #caption>Users must verify a phone number to create an account</template>
								</MkSwitch>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #icon><i class="ti ti-brand-alibaba"></i></template>
						<template #label><SearchLabel>Alibaba Cloud SMS</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkInput v-model="smsAliAccessKeyId">
									<template #prefix><i class="ti ti-key"></i></template>
									<template #label><SearchLabel>AccessKey ID</SearchLabel></template>
								</MkInput>
							</SearchMarker>

							<SearchMarker>
								<MkInput v-model="smsAliAccessKeySecret" type="password">
									<template #prefix><i class="ti ti-lock"></i></template>
									<template #label><SearchLabel>AccessKey Secret</SearchLabel></template>
								</MkInput>
							</SearchMarker>

							<SearchMarker>
								<MkInput v-model="smsAliSignName">
									<template #prefix><i class="ti ti-signature"></i></template>
									<template #label><SearchLabel>SMS Sign Name</SearchLabel></template>
									<template #caption>Registered SMS signature in Alibaba Cloud console</template>
								</MkInput>
							</SearchMarker>

							<SearchMarker>
								<MkInput v-model="smsAliTemplateCode">
									<template #prefix><i class="ti ti-code"></i></template>
									<template #label><SearchLabel>SMS Template Code</SearchLabel></template>
									<template #caption>Template code (e.g. SMS_123456789). Must contain {code} parameter.</template>
								</MkInput>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #icon><i class="ti ti-send"></i></template>
						<template #label><SearchLabel>Test SMS</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkInput v-model="testPhone">
									<template #label><SearchLabel>Phone Number</SearchLabel></template>
									<template #caption>E.164 format (e.g. +8613800138000)</template>
								</MkInput>
							</SearchMarker>

							<MkButton primary @click="testSms">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>

				<MkButton primary @click="save">{{ i18n.ts.save }}</MkButton>
			</div>
		</SearchMarker>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkFolder from '@/components/MkFolder.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { fetchInstance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';

const meta = await misskeyApi('admin/meta');

const enableSms = ref(meta.enableSms);
const phoneRequiredForSignup = ref(meta.phoneRequiredForSignup);
const smsAliAccessKeyId = ref(meta.smsAliAccessKeyId ?? '');
const smsAliAccessKeySecret = ref(meta.smsAliAccessKeySecret ?? '');
const smsAliSignName = ref(meta.smsAliSignName ?? '');
const smsAliTemplateCode = ref(meta.smsAliTemplateCode ?? '');
const testPhone = ref('');

function save() {
	os.apiWithDialog('admin/update-meta', {
		enableSms: enableSms.value,
		phoneRequiredForSignup: phoneRequiredForSignup.value,
		smsAliAccessKeyId: smsAliAccessKeyId.value || null,
		smsAliAccessKeySecret: smsAliAccessKeySecret.value || null,
		smsAliSignName: smsAliSignName.value || null,
		smsAliTemplateCode: smsAliTemplateCode.value || null,
	}).then(() => {
		fetchInstance(true);
	});
}

function testSms() {
	if (!testPhone.value) return;
	os.apiWithDialog('admin/send-sms', { phone: testPhone.value });
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: 'SMS',
	icon: 'ti ti-phone',
}));
</script>
