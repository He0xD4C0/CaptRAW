/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { SmsService } from '@/core/SmsService.js';
import { DI } from '@/di-symbols.js';
import type { UserProfilesRepository } from '@/models/_.js';

export const meta = {
	tags: ['phone'],

	requireCredential: false,

	limit: {
		duration: 1000 * 60 * 60, // 1 hour
		max: 30,
		minInterval: 1000 * 5, // 5 seconds
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			available: { type: 'boolean', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		phone: { type: 'string' },
	},
	required: ['phone'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		private smsService: SmsService,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,
	) {
		super(meta, paramDef, async (ps) => {
			// Validate format
			if (!this.smsService.validatePhoneFormat(ps.phone)) {
				return { available: false };
			}

			// Check uniqueness
			const existing = await this.userProfilesRepository.findOneBy({
				phone: ps.phone,
				phoneVerified: true,
			});

			return { available: !existing };
		});
	}
}
