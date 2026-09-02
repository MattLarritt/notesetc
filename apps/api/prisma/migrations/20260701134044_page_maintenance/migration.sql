-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "lastReviewedAt" TIMESTAMP(3),
ADD COLUMN     "lastReviewedById" TEXT,
ADD COLUMN     "reviewDueAt" TIMESTAMP(3),
ADD COLUMN     "reviewIntervalDays" INTEGER;

-- CreateTable
CREATE TABLE "PageMaintainer" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "principalType" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageMaintainer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PageMaintainer_principalType_principalId_idx" ON "PageMaintainer"("principalType", "principalId");

-- CreateIndex
CREATE UNIQUE INDEX "PageMaintainer_pageId_principalType_principalId_key" ON "PageMaintainer"("pageId", "principalType", "principalId");

-- CreateIndex
CREATE INDEX "Page_reviewDueAt_idx" ON "Page"("reviewDueAt");

-- AddForeignKey
ALTER TABLE "PageMaintainer" ADD CONSTRAINT "PageMaintainer_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
