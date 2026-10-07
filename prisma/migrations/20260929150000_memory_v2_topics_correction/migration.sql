-- KX-74 memory v2: procedural CORRECTION kind + topic tags for retrieval
ALTER TYPE "KernMemoryKind" ADD VALUE IF NOT EXISTS 'CORRECTION';
ALTER TABLE "KernMemory" ADD COLUMN IF NOT EXISTS "topics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
