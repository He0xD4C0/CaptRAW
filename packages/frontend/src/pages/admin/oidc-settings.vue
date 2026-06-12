<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<SearchMarker path="/admin/oidc-settings" label="OIDC" :keywords="['oidc', 'openid', 'connect', 'sso', 'auth']" icon="ti ti-key">
			<div class="_gaps_m">
				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #icon><i class="ti ti-toggle-right"></i></template>
						<template #label><SearchLabel>OIDC Provider</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSwitch v-model="enableOidc">
									<template #label><SearchLabel>Enable OIDC</SearchLabel></template>
									<template #caption>Enable OpenID Connect endpoints (/.well-known/openid-configuration, /oauth/jwks, /oauth/userinfo)</template>
								</MkSwitch>
							</SearchMarker>

							<MkButton primary @click="save_oidc">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #icon><i class="ti ti-json"></i></template>
						<template #label><SearchLabel>Key Information</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkKeyValue oneline>
									<template #key>JWKS Endpoint</template>
									<template #value><MkA :to="jwksUrl" behavior="browser">{{ jwksUrl }}</MkA></template>
								</MkKeyValue>
							</SearchMarker>

							<SearchMarker>
								<MkKeyValue oneline>
									<template #key>Signing Algorithm</template>
									<template #value>RS256</template>
								</MkKeyValue>
							</SearchMarker>

							<SearchMarker>
								<MkKeyValue oneline>
									<template #key>Active Keys</template>
									<template #value>{{ jwksKeysCount }}</template>
								</MkKeyValue>
							</SearchMarker>

							<MkButton @click="refreshKeys">{{ i18n.ts.reload }}</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #icon><i class="ti ti-world"></i></template>
						<template #label><SearchLabel>Discovery Endpoints</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkKeyValue oneline>
									<template #key>/.well-known/openid-configuration</template>
									<template #value><MkA :to="discoveryUrl" behavior="browser">{{ discoveryUrl }}</MkA></template>
								</MkKeyValue>
							</SearchMarker>

							<SearchMarker>
								<MkKeyValue oneline>
									<template #key>/.well-known/oauth-authorization-server</template>
									<template #value><MkA :to="oauthMetaUrl" behavior="browser">{{ oauthMetaUrl }}</MkA></template>
								</MkKeyValue>
							</SearchMarker>
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
import MkFolder from '@/components/MkFolder.vue';
import MkKeyValue from '@/components/MkKeyValue.vue';
import MkA from '@/components/global/MkA.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { fetchInstance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';

const meta = await misskeyApi('admin/meta');

const enableOidc = ref(meta.enableOidc);
const jwksKeysCount = ref(0);

const instanceUrl = meta.uri ?? location.origin;
const jwksUrl = computed(() => `${instanceUrl}/oauth/jwks`);
const discoveryUrl = computed(() => `${instanceUrl}/.well-known/openid-configuration`);
const oauthMetaUrl = computed(() => `${instanceUrl}/.well-known/oauth-authorization-server`);

async function refreshKeys() {
	try {
		const res = await fetch(jwksUrl.value);
		const data = await res.json();
		jwksKeysCount.value = Array.isArray(data.keys) ? data.keys.length : 0;
	} catch {
		jwksKeysCount.value = 0;
	}
}

// Initial key count fetch
refreshKeys();

function save_oidc() {
	os.apiWithDialog('admin/update-meta', {
		enableOidc: enableOidc.value,
	}).then(() => {
		fetchInstance(true);
	});
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: 'OIDC',
	icon: 'ti ti-key',
}));
</script>
