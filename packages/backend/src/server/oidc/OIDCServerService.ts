/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { bindThis } from '@/decorators.js';
import { OIDCKeypairService } from '@/core/OIDCKeypairService.js';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import type { AccessTokensRepository, UsersRepository, UserProfilesRepository } from '@/models/_.js';
import { LoggerService } from '@/core/LoggerService.js';
import Logger from '@/logger.js';

@Injectable()
export class OIDCServerService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.accessTokensRepository)
		private accessTokensRepository: AccessTokensRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private oidcKeypairService: OIDCKeypairService,
		loggerService: LoggerService,
	) {
		this.logger = loggerService.getLogger('oidc');
	}

	@bindThis
	public async createServer(fastify: FastifyInstance): Promise<void> {
		// GET /oauth/jwks
		fastify.get('/jwks', async (_request, reply) => {
			reply.header('Content-Type', 'application/json');
			reply.header('Cache-Control', 'public, max-age=604800'); // 1 week

			const keys = await this.oidcKeypairService.getAllPublicKeysForJWKS();

			return {
				keys,
			};
		});

		// GET /oauth/userinfo (OIDC spec requires GET)
		fastify.get('/userinfo', async (request: FastifyRequest, reply: FastifyReply) => {
			return this.handleUserinfo(request, reply);
		});

		// POST /oauth/userinfo (OIDC spec also allows POST)
		fastify.post('/userinfo', async (request: FastifyRequest, reply: FastifyReply) => {
			return this.handleUserinfo(request, reply);
		});
	}

	@bindThis
	private async handleUserinfo(request: FastifyRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
		// Extract Bearer token from Authorization header
		const authHeader = request.headers.authorization;
		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			reply.code(401);
			return {
				error: 'invalid_token',
				error_description: 'Missing or invalid authorization header',
			};
		}

		const token = authHeader.slice(7);

		// Find the access token in database
		const accessToken = await this.accessTokensRepository.findOneBy({ token });
		if (!accessToken) {
			this.logger.warn(`Invalid token used for userinfo: ${token}`);
			reply.code(401);
			return {
				error: 'invalid_token',
				error_description: 'Invalid or expired token',
			};
		}

		// Check that the token has the 'openid' scope (OIDC requirement)
		if (!accessToken.permission.includes('openid')) {
			this.logger.warn(`Token without openid scope used for userinfo: ${token}`);
			reply.code(403);
			return {
				error: 'insufficient_scope',
				error_description: 'Token does not have the required openid scope',
			};
		}

		// Fetch user information
		const user = await this.usersRepository.findOneBy({ id: accessToken.userId });
		if (!user) {
			this.logger.warn(`User not found for token: ${accessToken.userId}`);
			reply.code(500);
			return {
				error: 'server_error',
				error_description: 'User not found',
			};
		}

		// Fetch user profile for email information
		const userProfile = await this.userProfilesRepository.findOneBy({ userId: user.id });

		// Build userinfo response according to OIDC spec
		const userinfo: Record<string, unknown> = {
			sub: user.id,
		};

		// Only include claims that are within the token's scope
		if (accessToken.permission.includes('profile')) {
			userinfo.preferred_username = user.username;
			if (user.name) userinfo.name = user.name;
			if (user.avatarUrl) userinfo.picture = user.avatarUrl;
		}

		if (accessToken.permission.includes('email')) {
			if (userProfile?.email) {
				userinfo.email = userProfile.email;
				userinfo.email_verified = userProfile.emailVerified ?? false;
			}
		}

		reply.header('Content-Type', 'application/json');
		reply.header('Cache-Control', 'no-store');
		return userinfo;
	}
}
