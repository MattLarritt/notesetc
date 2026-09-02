-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "childTemplateId" TEXT;

-- AlterTable
ALTER TABLE "Space" ADD COLUMN     "defaultTemplateId" TEXT;

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Template_spaceId_idx" ON "Template"("spaceId");

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
