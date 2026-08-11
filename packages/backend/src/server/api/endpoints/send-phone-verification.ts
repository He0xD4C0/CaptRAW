/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { MiMeta } from '@/models/Meta.js';
import { SmsService } from '@/core/SmsService.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	requireCredential: false,

	limit: {
		duration: ms('1hour'),
		max: 3,
		minInterval: ms('30sec'),
	},

	errors: {
		phoneBindingDisabled: {
			message: 'Phone binding is disabled on this server.',
			code: 'PHONE_BINDING_DISABLED',
			id: '2267b556-bb90-4406-bddd-02978b0ab390',
		},
		invalidPhoneFormat: {
			message: 'Invalid phone number format.',
			code: 'INVALID_PHONE_FORMAT',
			id: '6cbdf7ef-fced-4baa-848e-345f423d1df4',
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
		@Inject(DI.meta)
		private serverMeta: MiMeta,

		private smsService: SmsService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!this.serverMeta.enablePhoneBinding) {
				throw new ApiError(meta.errors.phoneBindingDisabled);
			}

			if (!this.smsService.validatePhoneFormat(ps.phone)) {
				throw new ApiError(meta.errors.invalidPhoneFormat);
			}

			await this.smsService.sendVerificationCode(ps.phone);
		});
	}
}
