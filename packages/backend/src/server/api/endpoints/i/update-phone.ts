/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UserProfilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { SmsService } from '@/core/SmsService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';

export const meta = {
	tags: ['account'],

	requireCredential: true,
	secure: true,

	limit: {
		duration: 1000 * 60 * 60, // 1 hour
		max: 3,
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'MeDetailed',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		phone: { type: 'string', nullable: true },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private smsService: SmsService,
		private userEntityService: UserEntityService,
		private globalEventService: GlobalEventService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: me.id });

			if (ps.phone != null) {
				// Validate format
				if (!this.smsService.validatePhoneFormat(ps.phone)) {
					throw new Error('Invalid phone number format. Use E.164 format (e.g. +8613800138000)');
				}

				// Check uniqueness
				const existing = await this.userProfilesRepository.findOneBy({
					phone: ps.phone,
					phoneVerified: true,
				});
				if (existing && existing.userId !== me.id) {
					throw new Error('This phone number is already in use.');
				}

				// Update phone and send verification code
				await this.userProfilesRepository.update({ userId: me.id }, {
					phone: ps.phone,
					phoneVerified: false,
				});

				await this.smsService.sendVerificationCode(ps.phone);
			} else {
				// Clear phone
				await this.userProfilesRepository.update({ userId: me.id }, {
					phone: null,
					phoneVerified: false,
					phoneVerifyCode: null,
				});
			}

			await this.globalEventService.publishMainStream(me.id, 'meUpdated', await this.userEntityService.pack(me.id, me, {
				schema: 'MeDetailed',
			}));

			return await this.userEntityService.pack(me.id, me, {
				schema: 'MeDetailed',
				includeSecrets: true,
			});
		});
	}
}
