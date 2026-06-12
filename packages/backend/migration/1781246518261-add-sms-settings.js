/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddSmsFields1781246518261 {
	name = 'AddSmsFields1781246518261';
	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meta" ADD COLUMN "enableSms" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`ALTER TABLE "meta" ADD COLUMN "smsProvider" varchar(32) NOT NULL DEFAULT 'alibaba'`);
		await queryRunner.query(`ALTER TABLE "meta" ADD COLUMN "smsAliAccessKeyId" varchar(128)`);
		await queryRunner.query(`ALTER TABLE "meta" ADD COLUMN "smsAliAccessKeySecret" varchar(256)`);
		await queryRunner.query(`ALTER TABLE "meta" ADD COLUMN "smsAliSignName" varchar(64)`);
		await queryRunner.query(`ALTER TABLE "meta" ADD COLUMN "smsAliTemplateCode" varchar(64)`);
		await queryRunner.query(`ALTER TABLE "meta" ADD COLUMN "phoneRequiredForSignup" boolean NOT NULL DEFAULT false`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "phoneRequiredForSignup"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "smsAliTemplateCode"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "smsAliSignName"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "smsAliAccessKeySecret"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "smsAliAccessKeyId"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "smsProvider"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "enableSms"`);
	}
}
