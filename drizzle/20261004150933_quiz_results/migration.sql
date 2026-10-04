CREATE TABLE "novedu_quiz_results" (
	"id" varchar(36),
	"user_id" varchar(64),
	"code" varchar(32) NOT NULL,
	"correct" integer NOT NULL,
	"partial" integer NOT NULL,
	"incorrect" integer NOT NULL,
	"unanswered" integer NOT NULL,
	"total" integer NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "novedu_quiz_results_pkey" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "novedu_user_settings" (
	"user_id" varchar(64) PRIMARY KEY,
	"save_quiz_results" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ix_novedu_quiz_results_user_code_finished" ON "novedu_quiz_results" ("user_id","code","finished_at","id");--> statement-breakpoint
CREATE INDEX "ix_novedu_quiz_results_code" ON "novedu_quiz_results" ("code");--> statement-breakpoint
CREATE INDEX "ix_novedu_reports_user_id_resolved" ON "novedu_reports" ("user_id") WHERE "resolved_at" IS NOT NULL;