-- ContOS Approach B: durable avatar → organization mapping
-- Apply on self-hosted Postiz Postgres AFTER updating schema.prisma
-- Prefer: pnpm prisma-db-push (Postiz root) once schema is deployed.
--
-- Verified for ContOS ops without Subscription when STRIPE_SECRET_KEY and
-- STRIPE_PUBLISHABLE_KEY are unset (PublicAuthMiddleware + PermissionsService).

CREATE TABLE IF NOT EXISTS "ContosAvatarOrganization" (
  "id" TEXT NOT NULL,
  "contosAvatarId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContosAvatarOrganization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContosAvatarOrganization_contosAvatarId_key"
  ON "ContosAvatarOrganization"("contosAvatarId");

CREATE UNIQUE INDEX IF NOT EXISTS "ContosAvatarOrganization_organizationId_key"
  ON "ContosAvatarOrganization"("organizationId");

CREATE UNIQUE INDEX IF NOT EXISTS "ContosAvatarOrganization_userId_key"
  ON "ContosAvatarOrganization"("userId");

CREATE INDEX IF NOT EXISTS "ContosAvatarOrganization_organizationId_idx"
  ON "ContosAvatarOrganization"("organizationId");

CREATE INDEX IF NOT EXISTS "ContosAvatarOrganization_userId_idx"
  ON "ContosAvatarOrganization"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ContosAvatarOrganization_organizationId_fkey'
  ) THEN
    ALTER TABLE "ContosAvatarOrganization"
      ADD CONSTRAINT "ContosAvatarOrganization_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ContosAvatarOrganization_userId_fkey'
  ) THEN
    ALTER TABLE "ContosAvatarOrganization"
      ADD CONSTRAINT "ContosAvatarOrganization_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
