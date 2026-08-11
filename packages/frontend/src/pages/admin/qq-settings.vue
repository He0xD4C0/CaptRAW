<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<SearchMarker path="/admin/qq-settings" :label="i18n.ts._qqSettings.qqLogin" :keywords="['qq', 'tencent', 'oauth', 'social', 'login']" icon="ti ti-brand-qq">
			<div class="_gaps_m">
				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #icon><i class="ti ti-toggle-right"></i></template>
						<template #label>{{ i18n.ts._qqSettings.qqOAuthConfiguration }}</template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSwitch v-model="enableQqLogin">
									<template #label>{{ i18n.ts._qqSettings.enableQqLogin }}</template>
									<template #caption>{{ i18n.ts._qqSettings.enableQqLoginDescription }}</template>
								</MkSwitch>
							</SearchMarker>

							<SearchMarker>
								<MkInput v-model="qqClientId">
									<template #label>{{ i18n.ts._qqSettings.appId }}</template>
									<template #caption>{{ i18n.ts._qqSettings.appIdDescription }}</template>
								</MkInput>
							</SearchMarker>

							<SearchMarker>
								<MkInput v-model="qqClientSecret" type="password" :save="true">
									<template #label>{{ i18n.ts._qqSettings.appKey }}</template>
									<template #caption>{{ i18n.ts._qqSettings.appKeyDescription }}</template>
								</MkInput>
							</SearchMarker>

							<SearchMarker>
								<MkKeyValue oneline>
									<template #key>{{ i18n.ts._qqSettings.oauthCallbackUri }}</template>
									<template #value><MkA :to="callbackUri" behavior="browser">{{ callbackUri }}</MkA></template>
								</MkKeyValue>
							</SearchMarker>

							<SearchMarker>
								<MkKeyValue oneline>
									<template #key>{{ i18n.ts._qqSettings.authorizationEndpoint }}</template>
									<template #value><code style="word-break: break-all;">https://graph.qq.com/oauth2.0/authorize</code></template>
								</MkKeyValue>
							</SearchMarker>

							<SearchMarker>
								<MkKeyValue oneline>
									<template #key>{{ i18n.ts._qqSettings.tokenEndpoint }}</template>
									<template #value><code style="word-break: break-all;">https://graph.qq.com/oauth2.0/token</code></template>
								</MkKeyValue>
							</SearchMarker>

							<SearchMarker>
								<MkKeyValue oneline>
									<template #key>{{ i18n.ts._qqSettings.openidEndpoint }}</template>
									<template #value><code style="word-break: break-all;">https://graph.qq.com/oauth2.0/me</code></template>
								</MkKeyValue>
							</SearchMarker>

							<MkButton primary @click="save">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #icon><i class="ti ti-info-circle"></i></template>
						<template #label>{{ i18n.ts._qqSettings.setupGuide }}</template>

						<div class="_gaps_s">
							<p>{{ i18n.ts._qqSettings.setupGuideIntro }}</p>
							<ol style="padding-left: 20px; line-height: 1.8;">
								<li><MkA to="https://connect.qq.com/" behavior="browser">{{ i18n.ts._qqSettings.setupGuideVisit }}</MkA></li>
								<li>{{ i18n.ts._qqSettings.setupGuideVerify }}</li>
								<li>{{ i18n.ts._qqSettings.setupGuideCreate }}</li>
								<li>{{ i18n.ts._qqSettings.setupGuideDomain }}</li>
								<li>{{ i18n.ts._qqSettings.setupGuideCopy }}</li>
								<li>{{ i18n.ts._qqSettings.setupGuidePaste }}</li>
							</ol>
						</div>
					</MkFolder>
				</SearchMarker>
			</div>
		</SearchMarker>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkInput from '@/components/MkInput.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkKeyValue from '@/components/MkKeyValue.vue';
import MkA from '@/components/global/MkA.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { fetchInstance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';

const meta = await misskeyApi('admin/meta');

const enableQqLogin = ref(meta.enableQqLogin);
const qqClientId = ref(meta.qqClientId ?? '');
const qqClientSecret = ref(meta.qqClientSecret ?? '');

const instanceUrl = meta.uri ?? location.origin;
const callbackUri = computed(() => `${instanceUrl}/api/qq/callback`);

function save() {
	os.apiWithDialog('admin/update-meta', {
		enableQqLogin: enableQqLogin.value,
		qqClientId: qqClientId.value || null,
		qqClientSecret: qqClientSecret.value || null,
	}).then(() => {
		fetchInstance(true);
	});
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._qqSettings.qqLogin,
	icon: 'ti ti-brand-qq',
}));
</script>
