-- Automation names must be unique (friendly 409 in the service layer).
CREATE UNIQUE INDEX "Automation_name_key" ON "Automation"("name");

-- Variables become scoped: 'global' or an automation id. Uniqueness moves from
-- (name) to (scope, name). Existing rows (if any) become global.
ALTER TABLE "AutomationVariable" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'global';
DROP INDEX "AutomationVariable_name_key";
CREATE UNIQUE INDEX "AutomationVariable_scope_name_key" ON "AutomationVariable"("scope", "name");
