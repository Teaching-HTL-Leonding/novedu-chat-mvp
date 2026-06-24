CREATE TABLE [novedu_images] (
	[id] varchar(36),
	[name] nvarchar(450) NOT NULL,
	[blob_path] varchar(80) NOT NULL,
	[mime_type] varchar(32) NOT NULL,
	[byte_size] int NOT NULL,
	[created_by] nvarchar(64) NOT NULL,
	[valid_from] datetime2 NOT NULL,
	[valid_until] datetime2,
	[closed_by] nvarchar(64),
	CONSTRAINT [novedu_images_pkey] PRIMARY KEY([id])
);
--> statement-breakpoint
CREATE UNIQUE INDEX [ux_novedu_images_active_name] ON [novedu_images] ([name]) WHERE [valid_until] IS NULL;--> statement-breakpoint
CREATE INDEX [ix_novedu_images_valid_until] ON [novedu_images] ([valid_until]);