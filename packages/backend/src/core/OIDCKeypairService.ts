/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { generateKeyPair, exportSPKI, exportPKCS8 } from 'jose';
import { bindThis } from '@/decorators.js';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';

export interface OIDCKeyPair {
	privateKey: crypto.KeyObject;
	publicKey: crypto.KeyObject;
	privateKeyPem: string;
	publicKeyPem: string;
	kid: string;
}

export interface OIDCStoredKey {
	kid: string;
	privateKeyPem: string;
	publicKeyPem: string;
	createdAt: number;   // epoch seconds
	expiresAt: number;   // epoch seconds (createdAt + 90 days)
}

const ROTATION_INTERVAL = 30 * 24 * 60 * 60; // 30 days in seconds
const KEY_LIFETIME = 90 * 24 * 60 * 60;       // 90 days in seconds

@Injectable()
export class OIDCKeypairService {
	private keys: OIDCStoredKey[] = [];
	private activeKeypair: OIDCKeyPair | null = null;

	constructor(
		@Inject(DI.config)
		private config: Config,
	) {
		// Initial loading is done lazily in getOrGenerateKeyPair()
	}

	#getStoragePath(): string {
		return path.resolve(this.config.rootDir, 'files', 'oidc', 'keys.json');
	}

	#ensureDirectory(): void {
		const dir = path.dirname(this.#getStoragePath());
		fs.mkdirSync(dir, { recursive: true });
	}

	#loadKeys(): OIDCStoredKey[] {
		this.#ensureDirectory();
		const storagePath = this.#getStoragePath();

		if (!fs.existsSync(storagePath)) {
			return [];
		}

		try {
			const raw = fs.readFileSync(storagePath, 'utf-8');
			const loaded = JSON.parse(raw) as OIDCStoredKey[];
			if (!Array.isArray(loaded)) return [];
			return loaded;
		} catch {
			return [];
		}
	}

	#saveKeys(): void {
		this.#ensureDirectory();
		const storagePath = this.#getStoragePath();
		fs.writeFileSync(storagePath, JSON.stringify(this.keys, null, 2), 'utf-8');
	}

	#cleanExpiredKeys(now: number): void {
		const before = this.keys.length;
		this.keys = this.keys.filter(k => k.expiresAt > now);
		if (this.keys.length !== before) {
			this.#saveKeys();
		}
	}

	#checkAutoRotation(now: number): void {
		// Sort by createdAt descending (newest first)
		this.keys.sort((a, b) => b.createdAt - a.createdAt);

		const latestKey = this.keys[0];
		if (!latestKey || (now - latestKey.createdAt) >= ROTATION_INTERVAL) {
			// Generate a new key
			// Note: generateKeyPair is async, so we handle this in the async flow
			// We set a flag here and actually generate in getOrGenerateKeyPair()
			this.#needsNewKey = true;
		}
	}

	private needsNewKeyFlag: boolean | null = null;

	get #needsNewKey(): boolean {
		if (this.needsNewKeyFlag !== null) return this.needsNewKeyFlag;
		return this.keys.length === 0;
	}

	set #needsNewKey(value: boolean) {
		this.needsNewKeyFlag = value;
	}

	@bindThis
	public async getOrGenerateKeyPair(): Promise<OIDCKeyPair> {
		const now = Math.floor(Date.now() / 1000);

		// Load keys from disk on first access
		if (this.keys.length === 0 && !this.needsNewKeyFlag) {
			this.keys = this.#loadKeys();
		}

		// Clean expired keys
		this.#cleanExpiredKeys(now);

		// Check if we need to generate a new key (rotation)
		this.#checkAutoRotation(now);

		if (this.#needsNewKey || this.keys.length === 0) {
			// Generate new RSA 2048-bit key pair
			const { publicKey, privateKey } = await generateKeyPair('RS256', {
				modulusLength: 2048,
			});

			const publicKeyPem = await exportSPKI(publicKey);
			const privateKeyPem = await exportPKCS8(privateKey);

			const storedKey: OIDCStoredKey = {
				kid: Math.floor(Date.now() / 1000).toString(),
				privateKeyPem,
				publicKeyPem,
				createdAt: now,
				expiresAt: now + KEY_LIFETIME,
			};

			// Add to keys array (will be the newest)
			this.keys.unshift(storedKey);
			this.#saveKeys();

			// Cache the active keypair
			this.activeKeypair = this.#pemToKeyPair(storedKey);
			this.#needsNewKey = false;
			return this.activeKeypair;
		}

		// Use the newest key (first element after sort by #checkAutoRotation)
		const activeStoredKey = this.keys[0];

		if (!this.activeKeypair || this.activeKeypair.kid !== activeStoredKey.kid) {
			this.activeKeypair = this.#pemToKeyPair(activeStoredKey);
		}

		return this.activeKeypair;
	}

	#pemToKeyPair(storedKey: OIDCStoredKey): OIDCKeyPair {
		const nodePrivateKey = crypto.createPrivateKey(storedKey.privateKeyPem);
		const nodePublicKey = crypto.createPublicKey(storedKey.publicKeyPem);

		return {
			privateKey: nodePrivateKey,
			publicKey: nodePublicKey,
			privateKeyPem: storedKey.privateKeyPem,
			publicKeyPem: storedKey.publicKeyPem,
			kid: storedKey.kid,
		};
	}

	@bindThis
	public async getAllPublicKeysForJWKS(): Promise<Array<{
		kty: string;
		kid: string;
		use: string;
		alg: string;
		n: string;
		e: string;
	}>> {
		const now = Math.floor(Date.now() / 1000);

		// Load and clean if not loaded
		if (this.keys.length === 0) {
			this.keys = this.#loadKeys();
			this.#cleanExpiredKeys(now);
		}

		// Ensure at least one key exists
		if (this.keys.length === 0) {
			await this.getOrGenerateKeyPair();
		}

		// Return all valid (non-expired) keys
		const validKeys = this.keys.filter(k => k.expiresAt > now);

		return validKeys.map(storedKey => {
			const keyDetails = crypto.createPublicKey({
				key: storedKey.publicKeyPem,
				format: 'pem',
			});
			const exported = keyDetails.export({ format: 'jwk' });

			return {
				kty: 'RSA',
				kid: storedKey.kid,
				use: 'sig',
				alg: 'RS256',
				n: (exported as any).n,
				e: (exported as any).e,
			};
		});
	}

	/**
	 * @deprecated Use getAllPublicKeysForJWKS() instead, which returns all valid keys.
	 * Kept for backward compatibility.
	 */
	@bindThis
	public async getPublicKeyForJWKS(): Promise<{
		kty: string;
		kid: string;
		use: string;
		alg: string;
		n: string;
		e: string;
	}> {
		const keys = await this.getAllPublicKeysForJWKS();
		return keys[0];
	}
}
