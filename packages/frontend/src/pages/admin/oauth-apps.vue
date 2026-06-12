<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 900px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<SearchMarker path="/admin/oauth-apps" label="OAuth Apps" :keywords="['oauth', 'apps', 'clients', 'thirdparty']" icon="ti ti-apps">
			<div class="_gaps_m">
				<MkFolder :defaultOpen="false">
					<template #icon><i class="ti ti-plus"></i></template>
					<template #label>Create App</template>

					<div class="_gaps_m">
						<MkInput v-model="createForm.name">
							<template #label>Name</template>
						</MkInput>
						<MkInput v-model="createForm.description">
							<template #label>Description</template>
						</MkInput>
						<MkInput v-model="createForm.callbackUrl">
							<template #label>Callback URL</template>
							<template #caption>Leave empty for native apps</template>
						</MkInput>
						<MkInput v-model="createForm.permissionInput">
							<template #label>Permissions</template>
							<template #caption>Comma-separated, e.g.: read:account, write:notes</template>
						</MkInput>
						<MkButton primary :disabled="!canCreate" @click="createApp">Create App</MkButton>
					</div>
				</MkFolder>

				<MkPagination :paginator="appsPagination">
					<template #default="{ items }">
						<div class="_gaps_s">
							<MkFolder v-for="app in items" :key="app.id">
								<template #icon><i class="ti ti-apps"></i></template>
								<template #label>{{ app.name }}</template>
								<template #caption>{{ app.username ? `@${app.username}` : i18n.ts.unknown }}</template>
								<template #footer>
									<MkButton danger @click="deleteApp(app)">{{ i18n.ts.delete }}</MkButton>
								</template>

								<div class="_gaps_s">
									<MkKeyValue oneline>
										<template #key>App ID</template>
										<template #value><code>{{ app.id }}</code></template>
									</MkKeyValue>

									<MkKeyValue>
										<template #key>{{ i18n.ts.description }}</template>
										<template #value>{{ app.description || '-' }}</template>
									</MkKeyValue>

									<MkKeyValue>
										<template #key>Permissions</template>
										<template #value>
											<div class="_gaps_xs">
												<span v-for="perm in app.permission" :key="perm" class="_badge">{{ perm }}</span>
											</div>
										</template>
									</MkKeyValue>

									<MkKeyValue oneline>
										<template #key>Active Tokens</template>
										<template #value>{{ app.activeTokensCount }}</template>
									</MkKeyValue>

									<MkKeyValue v-if="app.callbackUrl" oneline>
										<template #key>Callback URL</template>
										<template #value><code>{{ app.callbackUrl }}</code></template>
									</MkKeyValue>
								</div>
							</MkFolder>
						</div>
					</template>
				</MkPagination>
			</div>
		</SearchMarker>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, reactive } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkInput from '@/components/MkInput.vue';
import MkKeyValue from '@/components/MkKeyValue.vue';
import MkPagination from '@/components/MkPagination.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { Paginator } from '@/utility/paginator.js';

const appsPagination = new Paginator('admin/oidc/apps', {
	limit: 30,
	params: {},
});

const createForm = reactive({
	name: '',
	description: '',
	callbackUrl: '',
	permissionInput: '',
});

const canCreate = computed(() => createForm.name.trim() !== '' && createForm.permissionInput.trim() !== '');

async function createApp() {
	if (!canCreate.value) return;

	const permissions = createForm.permissionInput.split(',').map(p => p.trim()).filter(Boolean);

	await os.apiWithDialog('admin/oidc/app-create', {
		name: createForm.name.trim(),
		description: createForm.description.trim() || ' ',
		permission: permissions,
		callbackUrl: createForm.callbackUrl.trim() || null,
	});

	// Reset form
	createForm.name = '';
	createForm.description = '';
	createForm.callbackUrl = '';
	createForm.permissionInput = '';

	appsPagination.reload();
}

async function deleteApp(app: { id: string; name: string }) {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: `Are you sure you want to delete the app "${app.name}"? All tokens issued for this app will be revoked.`,
	});
	if (canceled) return;

	await os.apiWithDialog('admin/oidc/app-delete', { appId: app.id });
	appsPagination.reload();
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: 'OAuth Apps',
	icon: 'ti ti-apps',
}));
</script>
