/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { generateKeyPair, exportSPKI, exportPKCS8 } from 'jose';
import { bindThis } from '@/decorators.js';

export interface OIDCKeyPair {
	privateKey: crypto.KeyObject;
	publicKey: crypto.KeyObject;
	privateKeyPem: string;
	publicKeyPem: string;
	kid: string; // Key ID
}

@Injectable()
export class OIDCKeypairService {
	private keypair: OIDCKeyPair | null = null;
	private readonly keyId: string;

	constructor() {
		// Generate a key ID based on timestamp
		this.keyId = Math.floor(Date.now() / 1000).toString();
	}

	@bindThis
	public async getOrGenerateKeyPair(): Promise<OIDCKeyPair> {
		if (this.keypair) {
			return this.keypair;
		}

		// Generate RSA 2048 bit key pair
		const { publicKey, privateKey } = await generateKeyPair('RS256', {
			modulusLength: 2048,
		});

		// Export keys to PEM format
		const publicKeyPem = await exportSPKI(publicKey);
		const privateKeyPem = await exportPKCS8(privateKey);

		// Convert PEM to Node.js KeyObject for signing
		const nodePrivateKey = crypto.createPrivateKey(privateKeyPem);
		const nodePublicKey = crypto.createPublicKey(publicKeyPem);

		this.keypair = {
			privateKey: nodePrivateKey,
			publicKey: nodePublicKey,
			privateKeyPem,
			publicKeyPem,
			kid: this.keyId,
		};

		return this.keypair;
	}

	@bindThis
	public async getPublicKeyForJWKS(): Promise<{
		kty: string;
		kid: string;
		use: string;
		alg: string;
		n: string;
		e: string;
	}> {
		const keypair = await this.getOrGenerateKeyPair();
		
		// Extract public key components
		const publicKeyDetails = crypto.createPublicKey({
			key: keypair.publicKeyPem,
			format: 'pem',
		}) as unknown as {
			asymmetricKeyDetails: {
				publicExponent: number;
				modulusLength: number;
			};
		};

		// Get modulus (n) and exponent (e)
		const keyDetails = crypto.createPublicKey({
			key: keypair.publicKeyPem,
			format: 'pem',
		});

		// Use Node's built-in RSA key export
		const exported = keyDetails.export({ format: 'jwk' });

		return {
			kty: 'RSA',
			kid: keypair.kid,
			use: 'sig',
			alg: 'RS256',
			n: (exported as any).n,
			e: (exported as any).e,
		};
	}
}
