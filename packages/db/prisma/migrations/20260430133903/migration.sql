/*
  Warnings:

  - The `language` column on the `rooms` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "RoomLanguage" AS ENUM ('TYPESCRIPT', 'PYTHON', 'JAVA', 'GO', 'CPP', 'C');

-- AlterTable
ALTER TABLE "rooms" DROP COLUMN "language",
ADD COLUMN     "language" "RoomLanguage" NOT NULL DEFAULT 'TYPESCRIPT';
