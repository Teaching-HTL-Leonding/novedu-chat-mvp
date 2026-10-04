CREATE TABLE "novedu_achievements" (
	"user_id" varchar(64),
	"achievement_id" varchar(64),
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"qualified_on" date NOT NULL,
	"seen_at" timestamp with time zone,
	CONSTRAINT "novedu_achievements_pkey" PRIMARY KEY("user_id","achievement_id")
);
