CREATE TABLE "novedu_codes" (
	"code" varchar(32) PRIMARY KEY,
	"module" varchar(16) NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"file_url" text NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"origin" text,
	"anonymous" boolean DEFAULT true NOT NULL,
	"llm_provider" varchar(32),
	"llm_model" text,
	"llm_reasoning" varchar(16),
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novedu_coding_keys" (
	"code" varchar(32),
	"user_id" varchar(64),
	"api_key" varchar(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "novedu_coding_keys_pkey" PRIMARY KEY("code","user_id")
);
--> statement-breakpoint
CREATE TABLE "novedu_files" (
	"id" varchar(36) PRIMARY KEY,
	"name" varchar(450) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"title" text,
	"description" text,
	"content" text NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	"closed_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "novedu_images" (
	"id" varchar(36) PRIMARY KEY,
	"name" varchar(450) NOT NULL,
	"blob_path" varchar(80) NOT NULL,
	"mime_type" varchar(32) NOT NULL,
	"byte_size" integer NOT NULL,
	"credit" text,
	"created_by" varchar(64) NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	"closed_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "novedu_recent_codes" (
	"user_id" varchar(64),
	"code" varchar(32),
	"last_used" timestamp with time zone NOT NULL,
	CONSTRAINT "novedu_recent_codes_pkey" PRIMARY KEY("user_id","code")
);
--> statement-breakpoint
CREATE TABLE "novedu_reports" (
	"id" varchar(36) PRIMARY KEY,
	"kind" varchar(16) NOT NULL,
	"code" varchar(32) NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"reaction" varchar(16) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"thread_id" varchar(64),
	"question_id" varchar(450),
	"question_text" text,
	"answer_text" text,
	"feedback_text" text,
	"verdict" varchar(16),
	"had_images" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "novedu_usage_by_code" (
	"code" varchar(32),
	"hour" timestamp with time zone,
	"module" varchar(16) NOT NULL,
	"provider" varchar(32),
	"model" text,
	"input_tokens_new" bigint DEFAULT 0 NOT NULL,
	"input_tokens_cached" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"user_messages" integer DEFAULT 0 NOT NULL,
	"quiz_answers" integer DEFAULT 0 NOT NULL,
	"writing_saves" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "novedu_usage_by_code_pkey" PRIMARY KEY("code","hour")
);
--> statement-breakpoint
CREATE TABLE "novedu_usage_by_user" (
	"user_id" varchar(64),
	"hour" timestamp with time zone,
	"input_tokens_new" bigint DEFAULT 0 NOT NULL,
	"input_tokens_cached" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"user_messages" integer DEFAULT 0 NOT NULL,
	"quiz_answers" integer DEFAULT 0 NOT NULL,
	"writing_saves" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "novedu_usage_by_user_pkey" PRIMARY KEY("user_id","hour")
);
--> statement-breakpoint
CREATE TABLE "novedu_user_chats" (
	"thread_id" varchar(64) PRIMARY KEY,
	"code" varchar(32) NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novedu_users" (
	"user_id" varchar(64) PRIMARY KEY,
	"display_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novedu_writing_submissions" (
	"code" varchar(32),
	"user_id" varchar(64),
	"text" text DEFAULT '' NOT NULL,
	"text_updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "novedu_writing_submissions_pkey" PRIMARY KEY("code","user_id")
);
--> statement-breakpoint
CREATE INDEX "ix_novedu_codes_created_by" ON "novedu_codes" ("created_by");--> statement-breakpoint
CREATE INDEX "ix_novedu_codes_module" ON "novedu_codes" ("module");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_novedu_coding_keys_api_key" ON "novedu_coding_keys" ("api_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_novedu_files_active_name" ON "novedu_files" ("name") WHERE "valid_until" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_novedu_files_valid_until" ON "novedu_files" ("valid_until");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_novedu_images_active_name" ON "novedu_images" ("name") WHERE "valid_until" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_novedu_images_valid_until" ON "novedu_images" ("valid_until");--> statement-breakpoint
CREATE INDEX "ix_novedu_reports_code" ON "novedu_reports" ("code");--> statement-breakpoint
CREATE INDEX "ix_novedu_reports_resolved_at" ON "novedu_reports" ("resolved_at");--> statement-breakpoint
CREATE INDEX "ix_novedu_usage_by_code_hour" ON "novedu_usage_by_code" ("hour");--> statement-breakpoint
CREATE INDEX "ix_novedu_user_chats_code" ON "novedu_user_chats" ("code");--> statement-breakpoint
CREATE INDEX "ix_novedu_user_chats_user_id" ON "novedu_user_chats" ("user_id");