CREATE TABLE "novedu_account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novedu_session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novedu_user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_teacher" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novedu_verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novedu_device_code" (
	"id" text PRIMARY KEY,
	"device_code" text NOT NULL,
	"user_code" text NOT NULL,
	"user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"last_polled_at" timestamp with time zone,
	"polling_interval" integer,
	"client_id" text,
	"scope" text
);
--> statement-breakpoint
CREATE INDEX "novedu_account_userId_idx" ON "novedu_account" ("user_id");--> statement-breakpoint
CREATE INDEX "novedu_session_userId_idx" ON "novedu_session" ("user_id");--> statement-breakpoint
CREATE INDEX "novedu_verification_identifier_idx" ON "novedu_verification" ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "novedu_device_code_deviceCode_uidx" ON "novedu_device_code" ("device_code");--> statement-breakpoint
CREATE UNIQUE INDEX "novedu_device_code_userCode_uidx" ON "novedu_device_code" ("user_code");--> statement-breakpoint
ALTER TABLE "novedu_account" ADD CONSTRAINT "novedu_account_user_id_novedu_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "novedu_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "novedu_session" ADD CONSTRAINT "novedu_session_user_id_novedu_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "novedu_user"("id") ON DELETE CASCADE;--> statement-breakpoint
INSERT INTO "novedu_user" (id, name, email, email_verified, is_teacher, created_at, updated_at)
SELECT ids.id, COALESCE(u.display_name, ids.id), ids.id || '@migrated.invalid', false, false, now(), now()
FROM (
	SELECT created_by AS id FROM novedu_codes
	UNION SELECT user_id FROM novedu_user_chats
	UNION SELECT user_id FROM novedu_recent_codes
	UNION SELECT user_id FROM novedu_writing_submissions
	UNION SELECT user_id FROM novedu_reports
	UNION SELECT resolved_by FROM novedu_reports
	UNION SELECT user_id FROM novedu_coding_keys
	UNION SELECT created_by FROM novedu_files
	UNION SELECT closed_by FROM novedu_files
	UNION SELECT created_by FROM novedu_images
	UNION SELECT closed_by FROM novedu_images
	UNION SELECT user_id FROM novedu_usage_by_user
	UNION SELECT user_id FROM novedu_users
) ids
LEFT JOIN novedu_users u ON u.user_id = ids.id
WHERE ids.id IS NOT NULL AND ids.id <> ''
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
INSERT INTO "novedu_account" (id, user_id, account_id, provider_id, created_at, updated_at)
SELECT gen_random_uuid()::text, id, id, 'microsoft', now(), now() FROM "novedu_user"
WHERE NOT EXISTS (SELECT 1 FROM "novedu_account" a WHERE a.user_id = "novedu_user".id);--> statement-breakpoint
DROP TABLE "novedu_users";
