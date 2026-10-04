ALTER TABLE "novedu_usage_by_code" ADD COLUMN "coding_requests" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "novedu_usage_by_user" ADD COLUMN "coding_requests" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_novedu_coding_keys_user_id" ON "novedu_coding_keys" ("user_id");