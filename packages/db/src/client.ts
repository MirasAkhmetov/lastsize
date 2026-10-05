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
  /**
   * Called when an idle connection fails (database restart, network drop). Without a listener
   * node-postgres would crash the process; the pool replaces broken connections by itself.
   */
  onIdleError?: (error: Error) => void;
}

export function createPool({
  connectionString,
  applicationName,
  maxConnections = 20,
  onIdleError = (error) => process.stderr.write(`postgres idle client error: ${error.message}\n`),
}: CreateDatabaseOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    application_name: applicationName,
    max: maxConnections,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', onIdleError);
  return pool;
}

export function createDatabase(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}
