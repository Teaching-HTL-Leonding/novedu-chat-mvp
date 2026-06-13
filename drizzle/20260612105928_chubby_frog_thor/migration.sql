CREATE TABLE [novedu_recent_codes] (
	[user_id] nvarchar(64),
	[code] varchar(10),
	[last_used] datetime2 NOT NULL,
	CONSTRAINT [novedu_recent_codes_pkey] PRIMARY KEY([user_id],[code])
);
--> statement-breakpoint
CREATE TABLE [novedu_tutor_codes] (
	[code] varchar(10),
	[created_by] nvarchar(64) NOT NULL,
	[tutor_url] nvarchar(2048) NOT NULL,
	[valid_from] datetime2 NOT NULL,
	[valid_until] datetime2 NOT NULL,
	[note] nvarchar(200) NOT NULL CONSTRAINT [novedu_tutor_codes_note_default] DEFAULT (''),
	[origin] nvarchar(256),
	[created_at] datetime2 NOT NULL,
	CONSTRAINT [novedu_tutor_codes_pkey] PRIMARY KEY([code])
);
--> statement-breakpoint
CREATE TABLE [novedu_user_chats] (
	[thread_id] varchar(64),
	[code] varchar(10) NOT NULL,
	[user_id] nvarchar(64) NOT NULL,
	[created_at] datetime2 NOT NULL,
	CONSTRAINT [novedu_user_chats_pkey] PRIMARY KEY([thread_id])
);
--> statement-breakpoint
CREATE INDEX [ix_novedu_tutor_codes_created_by] ON [novedu_tutor_codes] ([created_by]);--> statement-breakpoint
CREATE INDEX [ix_novedu_tutor_codes_valid_until] ON [novedu_tutor_codes] ([valid_until]);--> statement-breakpoint
CREATE INDEX [ix_novedu_user_chats_code] ON [novedu_user_chats] ([code]);--> statement-breakpoint
CREATE INDEX [ix_novedu_user_chats_user_id] ON [novedu_user_chats] ([user_id]);