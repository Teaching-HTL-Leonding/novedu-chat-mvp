CREATE TABLE [novedu_users] (
	[user_id] nvarchar(64),
	[display_name] nvarchar(256) NOT NULL,
	CONSTRAINT [novedu_users_pkey] PRIMARY KEY([user_id])
);
