/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddUserPhoneFields1781246518262 {
	name = 'AddUserPhoneFields1781246518262';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user_profile" ADD COLUMN "phone" varchar(32)`);
		await queryRunner.query(`ALTER TABLE "user_profile" ADD COLUMN "phoneVerified" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`ALTER TABLE "user_profile" ADD COLUMN "phoneVerifyCode" varchar(16)`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "phoneVerifyCode"`);
		await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "phoneVerified"`);
		await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "phone"`);
	}
}
