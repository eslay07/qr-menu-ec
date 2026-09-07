import { sqliteTable,text,integer } from 'drizzle-orm/sqlite-core';
export const application=sqliteTable('application',{id:text('id').primaryKey(),revision:integer('revision').notNull(),data:text('data').notNull()});
