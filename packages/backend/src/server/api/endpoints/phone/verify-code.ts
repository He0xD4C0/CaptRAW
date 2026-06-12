/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { SmsService } from '@/core/SmsService.js';
import { DI } from '@/di-symbols.js';
import type { UserProfilesRepository, UsersRepository } from '@/models/_.js';

export const meta = {
	tags: ['phone'],

	requireCredential: false,

	limit: {
		duration: 1000 * 60, // 1 minute
		max: 5,
		minInterval: 1000 * 10, // 10 seconds
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			verified: { type: 'boolean', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		phone: { type: 'string' },
		code: { type: 'string' },
	},
	required: ['phone', 'code'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		private smsService: SmsService,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,
	) {
		super(meta, paramDef, async (ps) => {
			const verified = await this.smsService.verifyCode(ps.phone, ps.code);
			return { verified };
		});
	}
}
