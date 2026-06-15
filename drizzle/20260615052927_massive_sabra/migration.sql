CREATE TABLE [novedu_files] (
	[id] varchar(36),
	[name] nvarchar(450) NOT NULL,
	[kind] varchar(16) NOT NULL,
	[title] nvarchar(512),
	[description] nvarchar(2048),
	[content] nvarchar(max) NOT NULL,
	[created_by] nvarchar(64) NOT NULL,
	[valid_from] datetime2 NOT NULL,
	[valid_until] datetime2,
	[closed_by] nvarchar(64),
	CONSTRAINT [novedu_files_pkey] PRIMARY KEY([id])
);
--> statement-breakpoint
CREATE UNIQUE INDEX [ux_novedu_files_active_name] ON [novedu_files] ([name]) WHERE [valid_until] IS NULL;--> statement-breakpoint
CREATE INDEX [ix_novedu_files_valid_until] ON [novedu_files] ([valid_until]);