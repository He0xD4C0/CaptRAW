/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddQqLoginFields1786283474484 {
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_profile" ADD COLUMN "qqOpenId" varchar(128)`);
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_user_profile_qqOpenId" ON "user_profile" ("qqOpenId") WHERE "qqOpenId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "meta" ADD COLUMN "enableQqLogin" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "meta" ADD COLUMN "qqClientId" varchar(256)`);
        await queryRunner.query(`ALTER TABLE "meta" ADD COLUMN "qqClientSecret" varchar(256)`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "qqClientSecret"`);
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "qqClientId"`);
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "enableQqLogin"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_profile_qqOpenId"`);
        await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "qqOpenId"`);
    }
}
