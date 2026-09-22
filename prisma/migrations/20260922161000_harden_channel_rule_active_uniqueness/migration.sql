-- Channel Route V1 concurrency guard.
-- Service-level supersession remains the normal write path; these partial unique
-- indexes prevent concurrent admin writes from leaving two current rules for
-- the same organization/channel and confidence state.

CREATE UNIQUE INDEX "ChannelRuleProfileRecord_one_active_confirmed_per_channel"
  ON "ChannelRuleProfileRecord"("organizationId", "channelKey")
  WHERE "status" = 'CONFIRMED';

CREATE UNIQUE INDEX "ChannelRuleProfileRecord_one_active_assumed_per_channel"
  ON "ChannelRuleProfileRecord"("organizationId", "channelKey")
  WHERE "status" = 'ASSUMED';
