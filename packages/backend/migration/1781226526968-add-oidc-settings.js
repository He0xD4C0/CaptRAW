/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddOidcSettings1781226526968 {
	name = 'AddOidcSettings1781226526968';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meta" ADD COLUMN "enableOidc" boolean NOT NULL DEFAULT true`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "enableOidc"`);
	}
}
