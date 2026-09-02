/*
  Warnings:

  - Added the required column `spaceId` to the `Attachment` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_pageId_fkey";

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "spaceId" TEXT NOT NULL,
ALTER COLUMN "pageId" DROP NOT NULL,
ALTER COLUMN "scanStatus" SET DEFAULT 'clean';

-- CreateIndex
CREATE INDEX "Attachment_spaceId_idx" ON "Attachment"("spaceId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
