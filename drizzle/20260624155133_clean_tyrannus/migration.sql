CREATE TABLE [novedu_writing_submissions] (
	[code] varchar(32),
	[user_id] nvarchar(64),
	[text] nvarchar(max) NOT NULL CONSTRAINT [novedu_writing_submissions_text_default] DEFAULT (''),
	[text_updated_at] datetime2 NOT NULL,
	CONSTRAINT [novedu_writing_submissions_pkey] PRIMARY KEY([code],[user_id])
);
