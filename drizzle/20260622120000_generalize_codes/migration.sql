CREATE TABLE [novedu_codes] (
	[code] varchar(32),
	[module] varchar(16) NOT NULL,
	[created_by] nvarchar(64) NOT NULL,
	[file_url] nvarchar(2048) NOT NULL,
	[valid_from] datetime2 NOT NULL,
	[valid_until] datetime2 NOT NULL,
	[note] nvarchar(200) NOT NULL CONSTRAINT [novedu_codes_note_default] DEFAULT (''),
	[origin] nvarchar(256),
	[anonymous] bit NOT NULL CONSTRAINT [novedu_codes_anonymous_default] DEFAULT ((1)),
	[created_at] datetime2 NOT NULL,
	CONSTRAINT [novedu_codes_pkey] PRIMARY KEY([code])
);
--> statement-breakpoint
INSERT INTO [novedu_codes] ([code], [module], [created_by], [file_url], [valid_from], [valid_until], [note], [origin], [anonymous], [created_at])
SELECT [code], 'tutor', [created_by], [tutor_url], [valid_from], [valid_until], [note], [origin], [anonymous], [created_at] FROM [novedu_tutor_codes];
--> statement-breakpoint
DROP TABLE [novedu_tutor_codes];
--> statement-breakpoint
CREATE INDEX [ix_novedu_codes_created_by] ON [novedu_codes] ([created_by]);--> statement-breakpoint
CREATE INDEX [ix_novedu_codes_module] ON [novedu_codes] ([module]);--> statement-breakpoint
DROP INDEX [ix_novedu_user_chats_code] ON [novedu_user_chats];--> statement-breakpoint
ALTER TABLE [novedu_user_chats] ALTER COLUMN [code] varchar(32) NOT NULL;--> statement-breakpoint
CREATE INDEX [ix_novedu_user_chats_code] ON [novedu_user_chats] ([code]);--> statement-breakpoint
ALTER TABLE [novedu_recent_codes] DROP CONSTRAINT [novedu_recent_codes_pkey];--> statement-breakpoint
ALTER TABLE [novedu_recent_codes] ALTER COLUMN [code] varchar(32) NOT NULL;--> statement-breakpoint
ALTER TABLE [novedu_recent_codes] ADD CONSTRAINT [novedu_recent_codes_pkey] PRIMARY KEY([user_id],[code]);
