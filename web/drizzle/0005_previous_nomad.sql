-- Duplicate of 0004_script_sync (same CREATE TABLE "script_file"), which broke migrating a
-- fresh database. Kept as a no-op so the journal and existing ledgers (matched by
-- created_at) stay valid.
SELECT 1;
