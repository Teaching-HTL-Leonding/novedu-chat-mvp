CREATE TABLE [novedu_coding_keys] (
	[code] varchar(32),
	[user_id] nvarchar(64),
	[api_key] varchar(64) NOT NULL,
	[created_at] datetime2 NOT NULL,
	CONSTRAINT [novedu_coding_keys_pkey] PRIMARY KEY([code],[user_id])
);
--> statement-breakpoint
CREATE UNIQUE INDEX [ux_novedu_coding_keys_api_key] ON [novedu_coding_keys] ([api_key]);