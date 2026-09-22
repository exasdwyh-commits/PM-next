-- Routed Agent wakeups for child-task completion return path

ALTER TYPE "AutopilotActionKind"
  ADD VALUE IF NOT EXISTS 'WAKE_ROUTED_AGENT';
