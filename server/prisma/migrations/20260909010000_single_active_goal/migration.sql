-- Enforce the same invariant under concurrent create/reactivation requests.
CREATE UNIQUE INDEX "Goal_one_active_per_user" ON "Goal" ("userId") WHERE "isActive" = true;
