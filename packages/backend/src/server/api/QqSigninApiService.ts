/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import * as Misskey from 'misskey-js';
import * as bcrypt from 'bcryptjs';
import { DI } from '@/di-symbols.js';
import type {
	MiMeta,
	SigninsRepository,
	UserProfilesRepository,
	UsersRepository,
} from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import type { Config } from '@/config.js';
import { getIpHash } from '@/misc/get-ip-hash.js';
import { IdService } from '@/core/IdService.js';
import { bindThis } from '@/decorators.js';
import { RateLimiterService } from '@/server/api/RateLimiterService.js';
import { SigninService } from '@/server/api/SigninService.js';
import { SignupService } from '@/core/SignupService.js';
import { DriveService } from '@/core/DriveService.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { QqOAuthService } from '@/core/QqOAuthService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { LoggerService } from '@/core/LoggerService.js';
import Logger from '@/logger.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

@Injectable()
export class QqSigninApiService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.signinsRepository)
		private signinsRepository: SigninsRepository,

		private loggerService: LoggerService,
		private idService: IdService,
		private rateLimiterService: RateLimiterService,
		private signinService: SigninService,
		private signupService: SignupService,
		private qqOAuthService: QqOAuthService,
		private userEntityService: UserEntityService,
		private driveService: DriveService,
		private driveFileEntityService: DriveFileEntityService,
	) {
		this.logger = this.loggerService.getLogger('qq-signin');
	}

	/**
	 * GET /api/qq/auth
	 * Initiates QQ OAuth login flow.
	 * Rate limited, generates state, redirects to QQ authorization page.
	 */
	@bindThis
	public async auth(
		request: FastifyRequest<{ Querystring: { redirect?: string } }>,
		reply: FastifyReply,
	) {
		// Check if QQ login is configured
		if (!this.qqOAuthService.isConfigured()) {
			this.logger.warn('QQ login attempted but not configured');
			reply.code(503);
			return reply.type('text/html; charset=utf-8').send(this.htmlError('QQ login is not available'));
		}

		// Rate limit
		if (this.config.enableIpRateLimit) {
			const rateLimit = await this.rateLimiterService.limit(
				{ key: 'qq-auth', duration: 60 * 60 * 1000, max: 20, minInterval: 3000 },
				getIpHash(request.ip),
			);
			if (rateLimit != null) {
				reply.code(429);
				return reply.type('text/html; charset=utf-8').send(this.htmlError('Too many requests. Please try again later.'));
			}
		}

		const redirectUri = `${this.config.url}/api/qq/callback`;
		const { url, state } = this.qqOAuthService.getAuthorizationUrl(redirectUri);

		this.logger.info(`Redirecting to QQ authorization page, state: ${state}`);
		reply.code(302).redirect(url);
	}

	/**
	 * GET /api/qq/callback
	 * Handles QQ OAuth callback.
	 * - Validates state
	 * - Exchanges code for token/openid/userinfo
	 * - Finds existing binding or shows registration form
	 * - Returns HTML with script for popup postMessage communication
	 */
	@bindThis
	public async callback(
		request: FastifyRequest<{ Querystring: { code?: string; state?: string } }>,
		reply: FastifyReply,
	) {
		reply.header('Cache-Control', 'no-store');

		// POST requests come from our own HTML forms (choice/binding/registration).
		// State validation is skipped — the form was only rendered after a successful
		// GET callback that already validated state/code and resolved the OpenID.
		if (request.method === 'POST') {
			const body = request.body as any;
			const action = body?.action;
			const formOpenId: string | undefined = body?.openId;

			if (!formOpenId) {
				this.logger.warn('QQ callback POST missing openId');
				return reply.type('text/html; charset=utf-8').send(this.htmlError('Invalid request: missing OpenID'));
			}

			if (action === 'register') {
				return this.handleRegistration(request, reply, formOpenId);
			} else if (action === 'bind') {
				return this.handleBinding(request, reply, formOpenId);
			}

			this.logger.warn(`QQ callback POST unknown action: ${action}`);
			return reply.type('text/html; charset=utf-8').send(this.htmlError('Invalid request: unknown action'));
		}

		// GET: OAuth redirect callback from Tencent
		const { code, state } = request.query;

		// Validate state parameter (HMAC-signed, no server-side cache needed)
		if (!state) {
			this.logger.warn('QQ callback missing state parameter');
			return reply.type('text/html; charset=utf-8').send(this.htmlError('Invalid request: missing state'));
		}

		if (!this.qqOAuthService.verifyState(state)) {
			this.logger.warn(`QQ callback with invalid state: ${state}`);
			return reply.type('text/html; charset=utf-8').send(this.htmlError('Invalid request: state expired or invalid'));
		}

		// Validate code parameter
		if (!code || typeof code !== 'string') {
			this.logger.warn('QQ callback missing code parameter');
			return reply.type('text/html; charset=utf-8').send(this.htmlError('Invalid request: missing authorization code'));
		}

		try {
			// Step 1: Exchange code for access token
			const redirectUri = `${this.config.url}/api/qq/callback`;
			const accessToken = await this.qqOAuthService.exchangeCode(code, redirectUri);

			// Step 2: Get OpenID
			const openId = await this.qqOAuthService.getOpenId(accessToken);

			// Step 3: Look up existing binding
			const existingProfile = await this.userProfilesRepository.findOneBy({ qqOpenId: openId });

			if (existingProfile) {
				// Already bound — sign in directly
				const user = await this.usersRepository.findOneBy({ id: existingProfile.userId }) as MiLocalUser;
				if (!user || user.isSuspended) {
					return reply.type('text/html; charset=utf-8').send(this.htmlError('Account is suspended or not found'));
				}

				this.logger.info(`QQ login: existing user ${user.username} (${user.id})`);
				const signinResult = await this.signinService.signin(request, reply, user);

				reply.header('Set-Cookie', `qq_temp_token=${signinResult.i!}; Path=/; Max-Age=120; SameSite=Lax`);
				return reply.type('text/html; charset=utf-8').send(
					this.htmlPostToken(user.id, signinResult.i!)
				);
			}

			// Step 4: Not yet bound — get QQ user info and show choice form
			const qqUserInfo = await this.qqOAuthService.getUserInfo(accessToken, openId);

			// Render choice form: register new account OR bind existing account
			return reply.type('text/html; charset=utf-8').send(
				this.htmlChoiceForm(openId, qqUserInfo)
			);
		} catch (err) {
			this.logger.error('QQ callback error', { error: err });
			return reply.type('text/html; charset=utf-8').send(
				this.htmlError(`Login failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
			);
		}
	}

	/**
	 * POST /api/qq/callback — handle username submission for new account registration
	 */
	@bindThis
	private async handleRegistration(
		request: FastifyRequest,
		reply: FastifyReply,
		openId: string,
	) {
		const body = request.body;

		if (!body || typeof body !== 'object') {
			return reply.type('text/html; charset=utf-8').send(this.htmlError('Invalid form submission'));
		}

		const formOpenId = (body as any).openId as string | undefined;
		const username = (body as any).username as string | undefined;
			const qqNickname = (body as any).qqNickname as string | undefined;
			const qqAvatarUrl = (body as any).qqAvatarUrl as string | undefined;
			const useQQProfile = (body as any).useQQProfile as string | undefined; // "on" or undefined
			const qqUserInfo = qqNickname ? { nickname: qqNickname, figureurl_2: qqAvatarUrl ?? '' } : null;

		if (!formOpenId || formOpenId !== openId || !username) {
			return reply.type('text/html; charset=utf-8').send(this.htmlRegisterForm(openId, qqUserInfo, 'Please choose a username.', ''));
		}

		// Validate username format
		if (!username.match(/^[a-zA-Z0-9_]{1,20}$/)) {
			return reply.type('text/html; charset=utf-8').send(
				this.htmlRegisterForm(openId, qqUserInfo, 'Invalid username. Use 1-20 alphanumeric characters or underscore.', username)
			);
		}

		// Check if username is taken
		const existingUser = await this.usersRepository.findOneBy({
			usernameLower: username.toLowerCase(),
			host: IsNull(),
		});
		if (existingUser) {
			return reply.type('text/html; charset=utf-8').send(
				this.htmlRegisterForm(openId, qqUserInfo, 'Username is already taken. Please choose another.', username)
			);
		}

		try {
			// Check if phone verification required for QQ registration
			if (this.meta.phoneRequiredForSignup) {
				return reply.type('text/html; charset=utf-8').send(
					this.htmlError('QQ registration requires phone verification. Please use the regular signup form.')
				);
			}

			// Create new account (passwordHash: null means no password — token-only login)
			const { account } = await this.signupService.signup({
				username,
				passwordHash: null,
			});
			// Bind QQ OpenID
			await this.userProfilesRepository.update({ userId: account.id }, {
				qqOpenId: openId,
			});
			// Auto-populate name and avatar from QQ profile (if user consented)
			if (useQQProfile === "on" && qqNickname) {
				const userUpdates: Record<string, unknown> = {};
				// Set display name (truncate to 50 chars per nameSchema)
				userUpdates.name = qqNickname.slice(0, 50);
				// Download avatar into Drive and set avatarId/avatarUrl/avatarBlurhash
				if (qqAvatarUrl) {
					try {
						const avatarFile = await this.driveService.uploadFromUrl({
							url: qqAvatarUrl,
							user: account as MiLocalUser,
						});
						userUpdates.avatarId = avatarFile.id;
						userUpdates.avatarUrl = this.driveFileEntityService.getPublicUrl(avatarFile, "avatar");
						userUpdates.avatarBlurhash = avatarFile.blurhash;
					} catch (err) {
						// Non-fatal: avatar download failed, account is already created.
						this.logger.warn(`QQ avatar download failed for user ${account.id}: ${err}`);
					}
				}
				await this.usersRepository.update({ id: account.id }, userUpdates);
			}
			this.logger.info(`QQ login: created new user ${username} (${account.id}) with QQ OpenID`);

			const user = account as MiLocalUser;
			const signinResult = await this.signinService.signin(request, reply, user);

			reply.header('Set-Cookie', `qq_temp_token=${signinResult.i!}; Path=/; Max-Age=120; SameSite=Lax`);
			reply.header('Set-Cookie', `qq_temp_id=${user.id}; Path=/; Max-Age=120; SameSite=Lax`);
			return reply.type('text/html; charset=utf-8').send(
				this.htmlPostToken(user.id, signinResult.i!)
			);
		} catch (err) {
			this.logger.error('QQ registration failed', { error: err });
			return reply.type('text/html; charset=utf-8').send(
				this.htmlRegisterForm(openId, qqUserInfo, `Registration failed: ${err instanceof Error ? err.message : 'Unknown error'}`, username)
			);
		}
	}

	/**
	 * POST /api/qq/callback (action=bind) — handle binding QQ to existing account
	 */
	@bindThis
	private async handleBinding(
		request: FastifyRequest,
		reply: FastifyReply,
		openId: string,
	): Promise<void> {
		const body = request.body as any;
		const username = body?.username;
		const password = body?.password;

		// Show form if credentials missing
		if (!username || !password) {
			return reply.type('text/html; charset=utf-8').send(
				this.htmlBindingForm(openId, 'Please provide username and password')
			);
		}

		try {
			// Find user
			const user = await this.usersRepository.findOneBy({
				usernameLower: username.toLowerCase(),
				host: IsNull(),
			}) as MiLocalUser | null;

			if (!user || user.isSuspended) {
				return reply.type('text/html; charset=utf-8').send(
					this.htmlBindingForm(openId, 'Invalid username or account suspended', username)
				);
			}

			// Verify password
			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: user.id });
			if (!profile.password) {
				return reply.type('text/html; charset=utf-8').send(
					this.htmlBindingForm(openId, 'This account does not use password login', username)
				);
			}

			const passwordMatches = await bcrypt.compare(password, profile.password);
			if (!passwordMatches) {
				return reply.type('text/html; charset=utf-8').send(
					this.htmlBindingForm(openId, 'Incorrect password', username)
				);
			}

			// Check duplicate binding
			const existingBinding = await this.userProfilesRepository.findOneBy({ qqOpenId: openId });
			if (existingBinding) {
				return reply.type('text/html; charset=utf-8').send(
					this.htmlError('This QQ account is already bound to another user')
				);
			}

			// Bind QQ to user
			await this.userProfilesRepository.update({ userId: user.id }, { qqOpenId: openId });

			this.logger.info(`QQ ${openId} bound to user ${username} (${user.id})`);

			// Sign in
			const signinResult = await this.signinService.signin(request, reply, user);

			reply.header('Set-Cookie', `qq_temp_token=${signinResult.i!}; Path=/; Max-Age=120; SameSite=Lax`);
			reply.header('Set-Cookie', `qq_temp_id=${user.id}; Path=/; Max-Age=120; SameSite=Lax`);
			return reply.type('text/html; charset=utf-8').send(
				this.htmlPostToken(user.id, signinResult.i!)
			);
		} catch (err) {
			this.logger.error('QQ binding failed', { error: err });
			return reply.type('text/html; charset=utf-8').send(
				this.htmlBindingForm(openId, `Binding failed: ${err instanceof Error ? err.message : 'Unknown error'}`, username)
			);
		}
	}

	/**
	 * Generate HTML that posts the token to the parent window via postMessage
	 */
	private htmlPostToken(userId: string, token: string): string {
		const origin = this.config.url;
		return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>QQ Login - Success</title></head>
<body style="text-align:center;font-family:sans-serif;padding-top:60px;">
	<h2>Login successful!</h2>
	<p id="msg">Completing login…</p>
	<script>
		if (window.opener) {
			window.opener.postMessage({ type: 'qq-login', id: ${JSON.stringify(userId)}, token: ${JSON.stringify(token)} }, ${JSON.stringify(origin)});
			setTimeout(function() { window.close(); }, 500);
		} else {
			// Mobile / PWA — cookie was set via Set-Cookie header.
			// Redirect to homepage; cookie will be consumed there.
			location.replace(${JSON.stringify(origin)} + '/');
		}
	</script>
</body>
</html>`;
	}

	/**
	 * Generate HTML choice form: register new account OR bind existing account
	 */
	@bindThis
	private htmlChoiceForm(openId: string, qqUserInfo: { nickname: string; figureurl: string; figureurl_2: string }): string {
		return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>QQ Login - Choose Action</title>
	<style>
		body { font-family: sans-serif; max-width: 500px; margin: 50px auto; padding: 20px; }
		.avatar { width: 80px; height: 80px; border-radius: 50%; }
		.actions { display: flex; gap: 20px; margin-top: 30px; }
		button { flex: 1; padding: 15px; font-size: 16px; cursor: pointer; border: 1px solid #ccc; border-radius: 8px; }
		button.primary { background: #1da1f2; color: white; border: none; }
	</style>
</head>
<body>
	<h2>Welcome, ${this.escapeHtml(qqUserInfo.nickname)}</h2>
	<img src="${qqUserInfo.figureurl}" class="avatar" alt="Avatar">
	<p>This QQ account is not linked to any Misskey account. What would you like to do?</p>

	<form method="POST" action="/api/qq/callback">
		<input type="hidden" name="openId" value="${this.escapeHtml(openId)}">
		<input type="hidden" name="action" value="register">
			<input type="hidden" name="qqNickname" value="${this.escapeHtml(qqUserInfo.nickname)}">
			<input type="hidden" name="qqAvatarUrl" value="${this.escapeHtml(qqUserInfo.figureurl_2)}">
		<div class="actions">
			<button type="submit" class="primary">Create New Account</button>
		</div>
	</form>

	<form method="POST" action="/api/qq/callback">
		<input type="hidden" name="openId" value="${this.escapeHtml(openId)}">
		<input type="hidden" name="action" value="bind">
		<div class="actions">
			<button type="submit">Bind to Existing Account</button>
		</div>
	</form>
</body>
</html>`;
	}

	/**
	 * Generate HTML binding form: login to bind QQ to existing account
	 */
	@bindThis
	private htmlBindingForm(openId: string, error?: string, prefillUsername?: string): string {
		return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>QQ Login - Bind to Account</title>
	<style>
		body { font-family: sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; }
		input { width: 100%; padding: 10px; margin: 10px 0; box-sizing: border-box; }
		button { width: 100%; padding: 12px; background: #1da1f2; color: white; border: none; border-radius: 8px; cursor: pointer; }
		.error { color: red; margin: 10px 0; }
	</style>
</head>
<body>
	<h2>Bind QQ to Your Account</h2>
	<p>Enter your Misskey credentials to link this QQ account.</p>
	${error ? `<div class="error">${this.escapeHtml(error)}</div>` : ''}

	<form method="POST" action="/api/qq/callback">
		<input type="hidden" name="openId" value="${this.escapeHtml(openId)}">
		<input type="hidden" name="action" value="bind">
		<input type="text" name="username" placeholder="Username" value="${prefillUsername || ''}" required>
		<input type="password" name="password" placeholder="Password" required>
		<button type="submit">Bind and Sign In</button>
	</form>
</body>
</html>`;
	}

	/**
	 * Generate HTML registration form for new QQ users
	 */
	private htmlRegisterForm(openId: string, qqUserInfo: { nickname: string; figureurl_2?: string } | null, error?: string, prefillUsername?: string): string {
		const nickname = qqUserInfo?.nickname ?? '';
		const avatar = qqUserInfo?.figureurl_2 ?? '';
		const errorHtml = error ? `<div style="color:#d32f2f;margin-bottom:12px;padding:8px;background:#fce4ec;border-radius:4px;">${this.escapeHtml(error)}</div>` : '';
		const usernameValue = prefillUsername ?? '';

		return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>QQ Login - Create Account</title>
	<style>
		* { box-sizing: border-box; margin: 0; padding: 0; }
		body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
		.container { background: white; border-radius: 12px; padding: 32px; max-width: 400px; width: 90%; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
		h2 { text-align: center; margin-bottom: 16px; color: #333; }
		.qq-info { display: flex; align-items: center; gap: 12px; padding: 12px; background: #f0f7ff; border-radius: 8px; margin-bottom: 20px; }
		.qq-avatar { width: 48px; height: 48px; border-radius: 50%; background: #e0e0e0; }
		.qq-nickname { font-weight: 600; color: #333; }
		.qq-label { font-size: 12px; color: #666; }
		.input-group { margin-bottom: 16px; }
		.input-group label { display: block; margin-bottom: 6px; font-weight: 500; color: #555; font-size: 14px; }
		.input-group input { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; }
		.input-group input:focus { outline: none; border-color: #1976d2; box-shadow: 0 0 0 2px rgba(25,118,210,0.2); }
		.btn { width: 100%; padding: 12px; background: #1976d2; color: white; border: none; border-radius: 6px; font-size: 15px; font-weight: 600; cursor: pointer; }
		.btn:hover { background: #1565c0; }
		.hint { font-size: 12px; color: #999; margin-top: 4px; }
	</style>
</head>
<body>
<div class="container">
	<h2>Create your account</h2>
	<div class="qq-info">
		${avatar ? `<img class="qq-avatar" src="${this.escapeHtml(avatar)}" alt="">` : '<div class="qq-avatar"></div>'}
		<div>
			<div class="qq-nickname">${this.escapeHtml(nickname)}</div>
			<div class="qq-label">QQ Account</div>
		</div>
	</div>
	${errorHtml}
	<form method="post" action="/api/qq/callback">
		<input type="hidden" name="openId" value="${this.escapeHtml(openId)}">
		<input type="hidden" name="action" value="register">
		<input type="hidden" name="qqNickname" value="${this.escapeHtml(nickname)}">
		<input type="hidden" name="qqAvatarUrl" value="${this.escapeHtml(avatar)}">
		<div class="input-group">
			<label for="username">Choose a username</label>
			<input id="username" name="username" type="text" pattern="[a-zA-Z0-9_]{1,20}" maxlength="20" placeholder="e.g. myname" value="${this.escapeHtml(usernameValue)}" required autofocus>
			<div class="hint">1-20 characters: letters, numbers, underscore</div>
		</div>
${nickname ? `<label class="qq-consent"><input type="checkbox" name="useQQProfile" checked> Use my QQ nickname and avatar as my profile</label>` : ""}
			<button class="btn" type="submit">Create Account & Sign In</button>
	</form>
</div>
</body>
</html>`;
	}

	/**
	 * Generate HTML error page
	 */
	private htmlError(message: string): string {
		return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>QQ Login - Error</title></head>
<body style="text-align:center;font-family:sans-serif;padding-top:60px;">
	<h2 style="color:#d32f2f;">Login Error</h2>
	<p>${this.escapeHtml(message)}</p>
	<p><a href="/">Return to homepage</a></p>
</body>
</html>`;
	}

	private escapeHtml(str: string): string {
		return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}
}
