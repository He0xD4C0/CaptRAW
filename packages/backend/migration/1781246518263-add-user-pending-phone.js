/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddUserPendingPhone1781246518263 {
	name = 'AddUserPendingPhone1781246518263';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user_pending" ADD COLUMN "phone" varchar(32)`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user_pending" DROP COLUMN "phone"`);
	}
}
