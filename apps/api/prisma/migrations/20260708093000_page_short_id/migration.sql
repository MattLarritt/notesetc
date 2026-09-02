-- Add a short, stable public code for pretty page URLs (/p/<slug>-<shortId>).
ALTER TABLE "Page" ADD COLUMN "shortId" TEXT;

-- Backfill existing rows with a random opaque code so none stay null. Each row
-- gets a distinct 10-char slice of a fresh UUID; new rows get one from the service.
UPDATE "Page"
SET "shortId" = substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)
WHERE "shortId" IS NULL;

-- Enforce uniqueness (matches the @unique in schema.prisma).
CREATE UNIQUE INDEX "Page_shortId_key" ON "Page"("shortId");
