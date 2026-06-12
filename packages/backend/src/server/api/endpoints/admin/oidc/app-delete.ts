/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { AppsRepository, AccessTokensRepository } from '@/models/_.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';

export const meta = {
	tags: ['admin', 'oidc', 'apps'],

	requireCredential: true,
	requireAdmin: true,
	kind: 'write:admin:meta',
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		appId: { type: 'string', format: 'misskey:id' },
	},
	required: ['appId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.appsRepository)
		private appsRepository: AppsRepository,

		@Inject(DI.accessTokensRepository)
		private accessTokensRepository: AccessTokensRepository,

		private moderationLogService: ModerationLogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const app = await this.appsRepository.findOneByOrFail({ id: ps.appId });

			// Revoke all tokens for this app
			const revokedCount = await this.accessTokensRepository.countBy({ appId: ps.appId });
			await this.accessTokensRepository.delete({ appId: ps.appId });

			// Delete the app
			await this.appsRepository.delete({ id: ps.appId });

			this.moderationLogService.log(me, 'updateServerSettings', {
				before: { action: 'deleteOAuthApp', appId: app.id, appName: app.name },
				after: { appId: app.id, appName: app.name, appUserId: app.userId, revokedTokens: revokedCount },
			});
		});
	}
}
