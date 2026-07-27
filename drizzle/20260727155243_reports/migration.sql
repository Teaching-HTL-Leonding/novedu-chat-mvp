CREATE TABLE [novedu_reports] (
	[id] varchar(36),
	[kind] varchar(16) NOT NULL,
	[code] varchar(32) NOT NULL,
	[user_id] nvarchar(64) NOT NULL,
	[reaction] varchar(16) NOT NULL,
	[description] nvarchar(2000) NOT NULL CONSTRAINT [novedu_reports_description_default] DEFAULT (''),
	[created_at] datetime2 NOT NULL,
	[thread_id] varchar(64),
	[question_id] nvarchar(450),
	[question_text] nvarchar(max),
	[answer_text] nvarchar(max),
	[feedback_text] nvarchar(max),
	[verdict] varchar(16),
	[had_images] bit NOT NULL CONSTRAINT [novedu_reports_had_images_default] DEFAULT ((0)),
	[resolved_at] datetime2,
	[resolved_by] nvarchar(64),
	CONSTRAINT [novedu_reports_pkey] PRIMARY KEY([id])
);
--> statement-breakpoint
CREATE INDEX [ix_novedu_reports_code] ON [novedu_reports] ([code]);--> statement-breakpoint
CREATE INDEX [ix_novedu_reports_resolved_at] ON [novedu_reports] ([resolved_at]);