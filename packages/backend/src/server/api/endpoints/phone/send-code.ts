/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { SmsService } from '@/core/SmsService.js';

export const meta = {
	tags: ['phone'],

	requireCredential: false,

	limit: {
		duration: 1000 * 60, // 1 minute
		max: 1,
		minInterval: 1000 * 60, // 1 minute
	},

	errors: {
		invalidPhone: {
			message: 'Invalid phone number format.',
			code: 'INVALID_PHONE',
			id: 'a0f4e620-26cb-4e28-aad6-8cbcb58db001',
		},
		rateLimit: {
			message: 'Too many requests. Please try again later.',
			code: 'RATE_LIMIT',
			id: 'b1f4e620-26cb-4e28-aad6-8cbcb58db002',
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
	) {
		super(meta, paramDef, async (ps) => {
			// Validate format
			if (!this.smsService.validatePhoneFormat(ps.phone)) {
				throw new ApiError({
					message: 'Invalid phone number format.',
					code: 'INVALID_PHONE',
					id: 'a0f4e620-26cb-4e28-aad6-8cbcb58db001',
				});
			}

			// Send verification code
			await this.smsService.sendVerificationCode(ps.phone);

			return;
		});
	}
}
