-- KX-73 三次成功才自动化：做法记录「连续验收通过」次数，达到门槛才允许转定时
ALTER TABLE "KernPlaybook"
  ADD COLUMN "acceptedStreak" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAcceptedAt" TIMESTAMP(3);
