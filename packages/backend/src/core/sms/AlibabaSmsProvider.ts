/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash, createHmac, randomUUID } from 'node:crypto';
import { bindThis } from '@/decorators.js';
import type { ISmsProvider } from './ISmsProvider.js';

export interface AlibabaSmsConfig {
	accessKeyId: string;
	accessKeySecret: string;
	signName: string;
	templateCode: string;
}

export class AlibabaSmsProvider implements ISmsProvider {
	public readonly name = 'Alibaba Cloud SMS';
	private accessKeyId: string;
	private accessKeySecret: string;
	private signName: string;
	private templateCode: string;
	private endpoint: string;

	constructor(config: AlibabaSmsConfig) {
		this.accessKeyId = config.accessKeyId;
		this.accessKeySecret = config.accessKeySecret;
		this.signName = config.signName;
		this.templateCode = config.templateCode;
		this.endpoint = 'https://dysmsapi.aliyuncs.com';
	}

	@bindThis
	public async sendVerificationCode(phone: string, code: string): Promise<void> {
		const params: Record<string, string> = {
			AccessKeyId: this.accessKeyId,
			Action: 'SendSms',
			Format: 'JSON',
			PhoneNumbers: phone,
			SignName: this.signName,
			TemplateCode: this.templateCode,
			TemplateParam: JSON.stringify({ code }),
			SignatureMethod: 'HMAC-SHA1',
			SignatureVersion: '1.0',
			SignatureNonce: randomUUID(),
			Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
			Version: '2017-05-25',
		};

		const sortedKeys = Object.keys(params).sort();
		const canonicalizedQueryString = sortedKeys
			.map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
			.join('&');

		const stringToSign = `GET&${encodeURIComponent('/')}&${encodeURIComponent(canonicalizedQueryString)}`;

		const signature = createHmac('sha1', `${this.accessKeySecret}&`)
			.update(stringToSign)
			.digest('base64');

		params.Signature = signature;

		const finalQueryString = sortedKeys
			.map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
			.join('&');

		const url = `${this.endpoint}/?${finalQueryString}`;

		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`Alibaba SMS HTTP error: ${response.status}`);
		}

		const data = await response.json() as { Code: string; Message: string };

		if (data.Code !== 'OK') {
			throw new Error(`Alibaba SMS send failed: ${data.Code} - ${data.Message}`);
		}
	}
}
