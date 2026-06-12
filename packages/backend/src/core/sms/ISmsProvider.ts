/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export interface ISmsProvider {
	/** Human-readable provider name */
	readonly name: string;

	/**
	 * Send a verification code SMS
	 * @param phone Phone number in E.164 format (e.g. +8613800138000)
	 * @param code Verification code to send
	 */
	sendVerificationCode(phone: string, code: string): Promise<void>;
}
