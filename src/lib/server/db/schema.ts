/**
 * @fileoverview Drizzle description of the SQLite schema, used by drizzle-kit tooling only. The
 * runtime schema (all tables) is defined in `../database/schema.ts` and shared by both backends.
 */
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
	id: text('id').primaryKey(),
	ownerId: text('owner_id').notNull(),
	name: text('name').notNull(),
	description: text('description').notNull().default(''),
	path: text('path').notNull().default(''),
	theme: text('theme').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull()
});

export const projectPages = sqliteTable('project_pages', {
	projectId: text('project_id').notNull(),
	id: text('id').notNull(),
	ordinal: integer('ordinal').notNull(),
	name: text('name').notNull(),
	slug: text('slug').notNull(),
	width: integer('width').notNull(),
	height: integer('height').notNull(),
	blocks: text('blocks').notNull()
});
