import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything that can run queries: the database itself or an open transaction. */
export type Executor = Database | Transaction;

export interface CreateDatabaseOptions {
  connectionString: string;
  applicationName: string;
  maxConnections?: number;
}

export function createPool({
  connectionString,
  applicationName,
  maxConnections = 20,
}: CreateDatabaseOptions): pg.Pool {
  return new pg.Pool({
    connectionString,
    application_name: applicationName,
    max: maxConnections,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function createDatabase(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}
