/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { AppsRepository, AccessTokensRepository, UsersRepository } from '@/models/_.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { MoreThan, LessThan } from 'typeorm';

export const meta = {
	tags: ['admin', 'oidc', 'apps'],

	requireCredential: true,
	requireAdmin: true,
	kind: 'read:admin:meta',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
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
				activeTokensCount: { type: 'number', optional: false, nullable: false },
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: [],
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
			const where: any = {};
			if (ps.sinceId) where.id = MoreThan(ps.sinceId);
			if (ps.untilId) where.id = { ...where.id, ...LessThan(ps.untilId) };

			const apps = await this.appsRepository.find({
				where,
				order: { id: 'DESC' },
				take: ps.limit,
				relations: { user: true },
			});

			const result = await Promise.all(apps.map(async (app) => {
				const tokenCount = await this.accessTokensRepository.countBy({ appId: app.id });
				return {
					id: app.id,
					name: app.name,
					description: app.description,
					userId: app.userId,
					username: app.user?.username ?? null,
					permission: app.permission,
					callbackUrl: app.callbackUrl,
					activeTokensCount: tokenCount,
				};
			}));

			return result;
		});
	}
}
