-- One active Product R&D program per project.
-- Accepted work is historical and does not block a future R&D round.
CREATE UNIQUE INDEX "WorkItem_one_active_product_rnd_per_project"
ON "WorkItem" ("projectId")
WHERE
  "title" = '产品研发综合评估'
  AND "executorType" = 'DIGITAL_WORKER'
  AND "status" IN ('TODO', 'RUNNING', 'SUBMITTED', 'CHANGES_REQUESTED');
