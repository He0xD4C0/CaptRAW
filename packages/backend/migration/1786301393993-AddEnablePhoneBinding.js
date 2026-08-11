/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddEnablePhoneBinding1786301393993 {
	async up(queryRunner) {
		await queryRunner.query(
			`ALTER TABLE "meta" ADD "enablePhoneBinding" boolean NOT NULL DEFAULT false`
		);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "enablePhoneBinding"`);
	}
}
