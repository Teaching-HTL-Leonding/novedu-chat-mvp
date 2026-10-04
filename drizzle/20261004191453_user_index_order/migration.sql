DROP INDEX "ix_novedu_coding_keys_user_id";--> statement-breakpoint
CREATE INDEX "ix_novedu_coding_keys_user_id" ON "novedu_coding_keys" ("user_id","created_at");--> statement-breakpoint
DROP INDEX "ix_novedu_reports_user_id_resolved";--> statement-breakpoint
CREATE INDEX "ix_novedu_reports_user_id_resolved" ON "novedu_reports" ("user_id","resolved_at") WHERE "resolved_at" IS NOT NULL;