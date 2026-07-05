ALTER TABLE [novedu_usage_by_code] ADD [provider] varchar(32);--> statement-breakpoint
ALTER TABLE [novedu_usage_by_code] ADD [model] nvarchar(256);--> statement-breakpoint
-- Backfill (hand-written): every pre-provider row was served by SCCH — the app knew
-- no other provider. `model` stays NULL: it genuinely was not recorded back then.
UPDATE [novedu_usage_by_code] SET [provider] = 'SCCH' WHERE [provider] IS NULL;