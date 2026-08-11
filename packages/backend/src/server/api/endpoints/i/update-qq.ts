/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { UserProfilesRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	tags: ['account', 'qq'],

	requireCredential: true,
	secure: true,

	limit: {
		duration: 60 * 60 * 1000,
		max: 3,
	},

	errors: {
		noQqBinding: {
			message: 'No QQ account is linked to this account.',
			code: 'NO_QQ_BINDING',
			id: '82f4ca13-be23-4ba0-8485-977358fe4648',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'MeDetailed',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private userEntityService: UserEntityService,
		private globalEventService: GlobalEventService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: me.id });

			if (!profile.qqOpenId) {
				throw new ApiError(meta.errors.noQqBinding);
			}

			await this.userProfilesRepository.update({ userId: me.id }, {
				qqOpenId: null,
			});

			// Publish meUpdated event so the client refreshes user state
			this.globalEventService.publishMainStream(me.id, 'meUpdated', await this.userEntityService.pack(me.id, me, {
				schema: 'MeDetailed',
			}));

			return await this.userEntityService.pack(me.id, me, {
				schema: 'MeDetailed',
				includeSecrets: true,
			});
		});
	}
}
