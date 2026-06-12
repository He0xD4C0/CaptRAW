/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { MiMeta, UserProfilesRepository } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';
import { AlibabaSmsProvider, type AlibabaSmsConfig } from './sms/AlibabaSmsProvider.js';
import type { ISmsProvider } from './sms/ISmsProvider.js';

@Injectable()
export class SmsService {
	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,
	) {}

	#getProvider(): ISmsProvider | null {
		if (!this.meta.enableSms) return null;

		switch (this.meta.smsProvider) {
			case 'alibaba': {
				const config: AlibabaSmsConfig = {
					accessKeyId: this.meta.smsAliAccessKeyId ?? '',
					accessKeySecret: this.meta.smsAliAccessKeySecret ?? '',
					signName: this.meta.smsAliSignName ?? '',
					templateCode: this.meta.smsAliTemplateCode ?? '',
				};

				if (!config.accessKeyId || !config.accessKeySecret || !config.signName || !config.templateCode) {
					return null;
				}

				return new AlibabaSmsProvider(config);
			}
			default:
				return null;
		}
	}

	@bindThis
	public async sendVerificationCode(phone: string): Promise<void> {
		const provider = this.#getProvider();
		if (!provider) {
			throw new Error('SMS provider is not configured');
		}

		// Generate 6-digit verification code
		const code = secureRndstr(6, { chars: '0123456789' });

		// Send SMS via provider
		await provider.sendVerificationCode(phone, code);

		// Store verification code in user profile
		await this.userProfilesRepository.update({ phone }, {
			phoneVerifyCode: code,
		});
	}

	@bindThis
	public async verifyCode(phone: string, code: string): Promise<boolean> {
		const profile = await this.userProfilesRepository.findOneBy({ phone });
		if (!profile?.phoneVerifyCode) return false;

		// Constant-time comparison for security
		const valid = profile.phoneVerifyCode === code;

		if (valid) {
			await this.userProfilesRepository.update({ phone }, {
				phoneVerified: true,
				phoneVerifyCode: null,
			});
		}

		return valid;
	}

	@bindThis
	public validatePhoneFormat(phone: string): boolean {
		// E.164 format: +[country code][number]
		// Basic validation: + followed by 7-15 digits
		return /^\+[1-9]\d{6,14}$/.test(phone);
	}
}
