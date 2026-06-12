/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { AppsRepository } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';
import { unique } from '@/misc/prelude/array.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';
import { AppEntityService } from '@/core/entities/AppEntityService.js';
import { DI } from '@/di-symbols.js';

export const meta = {
	tags: ['admin', 'oidc', 'apps'],

	requireCredential: true,
	requireAdmin: true,
	kind: 'write:admin:meta',

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'App',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		name: { type: 'string' },
		description: { type: 'string' },
		permission: { type: 'array', uniqueItems: true, items: {
			type: 'string',
		} },
		callbackUrl: { type: 'string', nullable: true },
		userId: { type: 'string', format: 'misskey:id', nullable: true },
	},
	required: ['name', 'description', 'permission'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.appsRepository)
		private appsRepository: AppsRepository,

		private appEntityService: AppEntityService,
		private idService: IdService,
	) {
		super(meta, paramDef, async (ps) => {
			// Generate secret
			const secret = secureRndstr(32);

			// for backward compatibility
			const permission = unique(ps.permission.map(v => v.replace(/^(.+)(\/|-)(read|write)$/, '$3:$1')));

			// Create app (with optional userId, or null for system-level app)
			const app = await this.appsRepository.insertOne({
				id: this.idService.gen(),
				userId: ps.userId ?? null,
				name: ps.name,
				description: ps.description,
				permission,
				callbackUrl: ps.callbackUrl ?? null,
				secret: secret,
			});

			return await this.appEntityService.pack(app, null, {
				detail: true,
				includeSecret: true,
			});
		});
	}
}
