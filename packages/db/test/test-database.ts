import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDatabase, createPool, type Database } from '../src/client.js';
import { runMigrations } from '../src/migrate.js';
import { seedReferenceData } from '../src/seed.js';

export interface TestDatabase {
  db: Database;
  pool: pg.Pool;
  drop: () => Promise<void>;
}

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/**
 * Creates an isolated, fully migrated and seeded database for one test file and drops it after.
 * Requires TEST_DATABASE_URL pointing at a role allowed to create databases.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is not set');
  const name = `lastsize_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: testDatabaseUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const url = new URL(testDatabaseUrl);
  url.pathname = `/${name}`;
  const pool = createPool({
    connectionString: url.toString(),
    applicationName: 'lastsize-test',
    maxConnections: 60,
  });
  const db = createDatabase(pool);
  await runMigrations(db);
  await seedReferenceData(db);

  return {
    db,
    pool,
    drop: async () => {
      await pool.end();
      const cleanup = new pg.Client({ connectionString: testDatabaseUrl });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await cleanup.end();
    },
  };
}
