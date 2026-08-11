/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DI } from '@/di-symbols.js';
import type { MiMeta } from '@/models/_.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { LoggerService } from '@/core/LoggerService.js';
import Logger from '@/logger.js';

export interface QqUserInfo {
	nickname: string;
	figureurl: string;
	figureurl_1: string;
	figureurl_2: string;
	figureurl_qq_1: string;
	figureurl_qq_2: string;
	gender: string;
}

@Injectable()
export class QqOAuthService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		private httpRequestService: HttpRequestService,
		loggerService: LoggerService,
	) {
		this.logger = loggerService.getLogger('qq-oauth');
	}

	/**
	 * Check if QQ login is properly configured
	 */
	public isConfigured(): boolean {
		return this.meta.enableQqLogin
			&& !!this.meta.qqClientId
			&& !!this.meta.qqClientSecret;
	}

	/**
	 * Generate an HMAC-signed state string so it can be verified without
	 * server-side storage. This avoids the clustering problem where
	 * different workers cannot share MemoryKVCache.
	 */
	@bindThis
	public signState(): string {
		const random = secureRndstr(32);
		const hmac = createHmac('sha256', this.meta.qqClientSecret!)
			.update(random)
			.digest('base64url');
		return `${random}.${hmac}`;
	}

	/**
	 * Verify an HMAC-signed state. Returns true if the signature is valid.
	 */
	@bindThis
	public verifyState(state: string): boolean {
		const idx = state.lastIndexOf('.');
		if (idx <= 0 || idx >= state.length - 1) return false;
		const random = state.slice(0, idx);
		const expectedHmac = createHmac('sha256', this.meta.qqClientSecret!)
			.update(random)
			.digest('base64url');
		try {
			return timingSafeEqual(
				Buffer.from(expectedHmac),
				Buffer.from(state.slice(idx + 1)),
			);
		} catch {
			return false;
		}
	}

	/**
	 * Generate QQ authorization URL with state parameter
	 * @param redirectUri The callback URL
	 * @returns Authorization URL and state string
	 */
	@bindThis
	public getAuthorizationUrl(redirectUri: string): { url: string; state: string } {
		const state = this.signState();
		const params = new URLSearchParams({
			response_type: 'code',
			client_id: this.meta.qqClientId!,
			redirect_uri: redirectUri,
			state,
			scope: 'get_user_info',
		});

		const url = `https://graph.qq.com/oauth2.0/authorize?${params.toString()}`;
		this.logger.info(`Generated QQ authorization URL with state: ${state}`);
		return { url, state };
	}

	/**
	 * Exchange authorization code for access token
	 * QQ returns the result as query-string format, not JSON
	 * @param code Authorization code from QQ
	 * @param redirectUri The same redirect URI used in authorization
	 * @returns access_token string
	 */
	@bindThis
	public async exchangeCode(code: string, redirectUri: string): Promise<string> {
		const clientId = this.meta.qqClientId!;
		const clientSecret = this.meta.qqClientSecret!;

		const params = new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: clientId,
			client_secret: clientSecret,
			code,
			redirect_uri: redirectUri,
		});

		const url = `https://graph.qq.com/oauth2.0/token?${params.toString()}`;
		this.logger.info('Exchanging QQ authorization code for access token...');

		try {
			const res = await this.httpRequestService.send(url, {
				method: 'GET',
				headers: { Accept: 'text/plain, */*' },
				timeout: 15000,
			}, {
				throwErrorWhenResponseNotOk: false,
			});

			const text = await res.text();

			// QQ returns errors as query-string with callback wrapper sometimes
			// e.g. callback({"error":100020,"error_description":"code is invalid"});
			const jsonpMatch = text.match(/^\s*callback\s*\((.+)\)\s*;?\s*$/);
			if (jsonpMatch) {
				const inner = JSON.parse(jsonpMatch[1]);
				if (inner.error) {
					throw new Error(`QQ OAuth token error: ${inner.error} - ${inner.error_description ?? 'unknown'}`);
				}
				throw new Error(`QQ OAuth token returned unexpected JSONP: ${text}`);
			}

			// Normal success response is query-string: access_token=XXX&expires_in=7776000&refresh_token=XXX
			const parsed = new URLSearchParams(text);
			const accessToken = parsed.get('access_token');
			const errorCode = parsed.get('error');

			if (errorCode) {
				throw new Error(`QQ OAuth token error: ${errorCode} - ${parsed.get('error_description') ?? 'unknown'}`);
			}

			if (!accessToken) {
				throw new Error(`QQ OAuth token response missing access_token: ${text}`);
			}

			this.logger.info('Successfully obtained QQ access token');
			return accessToken;
		} catch (err) {
			if (err instanceof Error && err.message.startsWith('QQ OAuth')) {
				throw err;
			}
			this.logger.error('Failed to exchange QQ authorization code', { error: err });
			throw new Error(`Failed to exchange QQ authorization code: ${err}`);
		}
	}

	/**
	 * Get QQ OpenID for the user
	 * QQ returns this as JSONP: callback({"client_id":"APPID","openid":"xxx"});
	 * @param accessToken The access token
	 * @returns openid string
	 */
	@bindThis
	public async getOpenId(accessToken: string): Promise<string> {
		const url = `https://graph.qq.com/oauth2.0/me?access_token=${encodeURIComponent(accessToken)}&fmt=json`;

		this.logger.info('Fetching QQ OpenID...');

		try {
			const res = await this.httpRequestService.send(url, {
				method: 'GET',
				headers: { Accept: 'application/json, */*' },
				timeout: 15000,
			}, {
				throwErrorWhenResponseNotOk: false,
			});

			const text = await res.text();

			// Try JSON first (fmt=json)
			try {
				const json = JSON.parse(text);
				if (json.error) {
					throw new Error(`QQ OAuth OpenID error: ${json.error} - ${json.error_description ?? 'unknown'}`);
				}
				if (json.openid) {
					this.logger.info(`Successfully obtained QQ OpenID: ${json.openid}`);
					return json.openid;
				}
			} catch (e) {
				if (e instanceof Error && e.message.startsWith('QQ OAuth')) throw e;
				// Not JSON, try JSONP format
			}

			// JSONP fallback: callback({"client_id":"APPID","openid":"xxx"});
			const jsonpMatch = text.match(/^\s*callback\s*\((.+)\)\s*;?\s*$/);
			if (jsonpMatch) {
				const inner = JSON.parse(jsonpMatch[1]);
				if (inner.error) {
					throw new Error(`QQ OAuth OpenID error: ${inner.error} - ${inner.error_description ?? 'unknown'}`);
				}
				if (inner.openid) {
					this.logger.info(`Successfully obtained QQ OpenID: ${inner.openid}`);
					return inner.openid;
				}
			}

			throw new Error(`QQ OAuth OpenID response unexpected: ${text}`);
		} catch (err) {
			if (err instanceof Error && err.message.startsWith('QQ OAuth')) {
				throw err;
			}
			this.logger.error('Failed to get QQ OpenID', { error: err });
			throw new Error(`Failed to get QQ OpenID: ${err}`);
		}
	}

	/**
	 * Get QQ user profile information
	 * @param accessToken The access token
	 * @param openId The user's OpenID
	 * @returns User profile info
	 */
	@bindThis
	public async getUserInfo(accessToken: string, openId: string): Promise<QqUserInfo> {
		const clientId = this.meta.qqClientId!;
		const params = new URLSearchParams({
			access_token: accessToken,
			oauth_consumer_key: clientId,
			openid: openId,
		});

		const url = `https://graph.qq.com/user/get_user_info?${params.toString()}`;
		this.logger.info('Fetching QQ user info...');

		try {
			const res = await this.httpRequestService.send(url, {
				method: 'GET',
				headers: { Accept: 'application/json, */*' },
				timeout: 15000,
			}, {
				throwErrorWhenResponseNotOk: false,
			});

			const text = await res.text();

			let json: any;
			try {
				json = JSON.parse(text);
			} catch {
				throw new Error(`QQ OAuth user info response not valid JSON: ${text}`);
			}

			// ret: 0 means success
			if (json.ret !== 0) {
				throw new Error(`QQ OAuth user info error: ${json.ret} - ${json.msg ?? 'unknown'}`);
			}

			this.logger.info(`Successfully obtained QQ user info for nickname: ${json.nickname}`);
			return {
				nickname: json.nickname ?? '',
				figureurl: json.figureurl ?? '',
				figureurl_1: json.figureurl_1 ?? '',
				figureurl_2: json.figureurl_2 ?? '',
				figureurl_qq_1: json.figureurl_qq_1 ?? '',
				figureurl_qq_2: json.figureurl_qq_2 ?? '',
				gender: json.gender ?? '',
			};
		} catch (err) {
			if (err instanceof Error && err.message.startsWith('QQ OAuth')) {
				throw err;
			}
			this.logger.error('Failed to get QQ user info', { error: err });
			throw new Error(`Failed to get QQ user info: ${err}`);
		}
	}
}
