ALTER TABLE "User"
  ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "User_organizationId_isSystem_idx"
  ON "User"("organizationId", "isSystem");
