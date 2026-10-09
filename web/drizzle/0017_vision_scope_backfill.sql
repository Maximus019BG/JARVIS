-- Devices approved before the `vision` area existed get what approval grants today:
-- write-mode devices (they hold blueprints:write) both vision scopes, read-mode ones read.
-- Empty scopes are pending pairings, which approval fills in itself.
UPDATE "device" SET "scopes" = array_cat("scopes", ARRAY['vision:read', 'vision:write'])
WHERE 'blueprints:write' = ANY("scopes") AND NOT ('vision:read' = ANY("scopes") OR 'vision:write' = ANY("scopes"));
--> statement-breakpoint
UPDATE "device" SET "scopes" = array_append("scopes", 'vision:read')
WHERE cardinality("scopes") > 0 AND NOT ('vision:read' = ANY("scopes") OR 'vision:write' = ANY("scopes"));
