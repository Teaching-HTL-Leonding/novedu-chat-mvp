CREATE TABLE [novedu_usage_by_code] (
	[code] varchar(32),
	[hour] datetime2,
	[module] varchar(16) NOT NULL,
	[input_tokens_new] bigint NOT NULL CONSTRAINT [novedu_usage_by_code_input_tokens_new_default] DEFAULT ((0)),
	[input_tokens_cached] bigint NOT NULL CONSTRAINT [novedu_usage_by_code_input_tokens_cached_default] DEFAULT ((0)),
	[output_tokens] bigint NOT NULL CONSTRAINT [novedu_usage_by_code_output_tokens_default] DEFAULT ((0)),
	[tool_calls] int NOT NULL CONSTRAINT [novedu_usage_by_code_tool_calls_default] DEFAULT ((0)),
	[user_messages] int NOT NULL CONSTRAINT [novedu_usage_by_code_user_messages_default] DEFAULT ((0)),
	[quiz_answers] int NOT NULL CONSTRAINT [novedu_usage_by_code_quiz_answers_default] DEFAULT ((0)),
	[writing_saves] int NOT NULL CONSTRAINT [novedu_usage_by_code_writing_saves_default] DEFAULT ((0)),
	CONSTRAINT [novedu_usage_by_code_pkey] PRIMARY KEY([code],[hour])
);
--> statement-breakpoint
CREATE TABLE [novedu_usage_by_user] (
	[user_id] nvarchar(64),
	[hour] datetime2,
	[input_tokens_new] bigint NOT NULL CONSTRAINT [novedu_usage_by_user_input_tokens_new_default] DEFAULT ((0)),
	[input_tokens_cached] bigint NOT NULL CONSTRAINT [novedu_usage_by_user_input_tokens_cached_default] DEFAULT ((0)),
	[output_tokens] bigint NOT NULL CONSTRAINT [novedu_usage_by_user_output_tokens_default] DEFAULT ((0)),
	[tool_calls] int NOT NULL CONSTRAINT [novedu_usage_by_user_tool_calls_default] DEFAULT ((0)),
	[user_messages] int NOT NULL CONSTRAINT [novedu_usage_by_user_user_messages_default] DEFAULT ((0)),
	[quiz_answers] int NOT NULL CONSTRAINT [novedu_usage_by_user_quiz_answers_default] DEFAULT ((0)),
	[writing_saves] int NOT NULL CONSTRAINT [novedu_usage_by_user_writing_saves_default] DEFAULT ((0)),
	CONSTRAINT [novedu_usage_by_user_pkey] PRIMARY KEY([user_id],[hour])
);
--> statement-breakpoint
CREATE INDEX [ix_novedu_usage_by_code_hour] ON [novedu_usage_by_code] ([hour]);