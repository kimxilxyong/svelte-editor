import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const task = sqliteTable('task', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	title: text('title').notNull(),
	priority: integer('priority').notNull().default(1)
});

export const editorPage = sqliteTable('editor_page', {
	id: text('id').primaryKey(),
	blocks: text('blocks').notNull(),
	updatedAt: text('updated_at').notNull()
});
