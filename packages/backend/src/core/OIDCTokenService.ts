/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { SignJWT } from 'jose';
import { bindThis } from '@/decorators.js';
import { OIDCKeypairService } from '@/core/OIDCKeypairService.js';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import type { MiUser, UserProfilesRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';

export interface IDTokenPayload {
	sub: string; // User ID
	aud: string; // Client ID
	iss: string; // Issuer (server URL)
	iat: number; // Issued at
	exp: number; // Expiration time
	auth_time?: number; // Time of authentication (OIDC spec)
	nonce?: string; // Nonce value from authorization request (OIDC spec)
	preferred_username?: string;
	name?: string;
	picture?: string;
	email?: string;
	email_verified?: boolean;
}

export interface IDTokenOptions {
	nonce?: string;
	authTime?: number;
	expiresIn?: number;
}

@Injectable()
export class OIDCTokenService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private oidcKeypairService: OIDCKeypairService,
	) {}

	@bindThis
	public async generateIdToken(
		user: MiUser | MiLocalUser,
		clientId: string,
		options?: IDTokenOptions,
	): Promise<string> {
		const keypair = await this.oidcKeypairService.getOrGenerateKeyPair();
		const now = Math.floor(Date.now() / 1000);
		const expiresIn = options?.expiresIn ?? 3600; // 1 hour default

		// Fetch user profile for email information
		const userProfile = await this.userProfilesRepository.findOneBy({ userId: user.id });

		// Prepare JWT claims
		const payload: IDTokenPayload = {
			sub: user.id,
			aud: clientId,
			iss: this.config.url,
			iat: now,
			exp: now + expiresIn,
			auth_time: options?.authTime ?? now,
			preferred_username: user.username,
			name: user.name ?? undefined,
			picture: user.avatarUrl ?? undefined,
			email: userProfile?.email ?? undefined,
			email_verified: userProfile?.emailVerified ?? false,
		};

		// Include nonce if provided (OIDC spec: required when nonce was sent in auth request)
		if (options?.nonce) {
			payload.nonce = options.nonce;
		}

		// Filter out undefined values
		const claims = Object.fromEntries(
			Object.entries(payload).filter(([, v]) => v !== undefined)
		);

		// Sign JWT with RS256
		const token = await new SignJWT(claims)
			.setProtectedHeader({
				alg: 'RS256',
				typ: 'JWT',
				kid: keypair.kid,
			})
			.sign(keypair.privateKey);

		return token;
	}

	@bindThis
	public async generateAccessTokenResponse(
		user: MiUser | MiLocalUser,
		clientId: string,
		accessToken: string,
		scope: string[] = [],
		options?: IDTokenOptions,
	): Promise<{
		access_token: string;
		id_token: string;
		token_type: string;
		expires_in: number;
		scope: string;
	}> {
		const idToken = await this.generateIdToken(user, clientId, options);

		return {
			access_token: accessToken,
			id_token: idToken,
			token_type: 'Bearer',
			expires_in: options?.expiresIn ?? 3600,
			scope: scope.join(' '),
		};
	}
}
