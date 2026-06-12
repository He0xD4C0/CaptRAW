/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { AppsRepository, AccessTokensRepository, UsersRepository } from '@/models/_.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';

export const meta = {
	tags: ['admin', 'oidc', 'apps'],

	requireCredential: true,
	requireAdmin: true,
	kind: 'read:admin:meta',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			id: { type: 'string', optional: false, nullable: false },
			name: { type: 'string', optional: false, nullable: false },
			description: { type: 'string', optional: false, nullable: false },
			userId: { type: 'string', optional: false, nullable: true },
			username: { type: 'string', optional: false, nullable: true },
			permission: { type: 'array', items: { type: 'string' } },
			callbackUrl: { type: 'string', optional: false, nullable: true },
			secret: { type: 'string', optional: false, nullable: false },
			activeTokensCount: { type: 'number', optional: false, nullable: false },
		},
	},
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

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,
	) {
		super(meta, paramDef, async (ps) => {
			const app = await this.appsRepository.findOneOrFail({
				where: { id: ps.appId },
				relations: { user: true },
			});

			const tokenCount = await this.accessTokensRepository.countBy({ appId: app.id });

			return {
				id: app.id,
				name: app.name,
				description: app.description,
				userId: app.userId,
				username: app.user?.username ?? null,
				permission: app.permission,
				callbackUrl: app.callbackUrl,
				secret: app.secret,
				activeTokensCount: tokenCount,
			};
		});
	}
}
