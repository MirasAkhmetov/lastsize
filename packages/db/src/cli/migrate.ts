import { createDatabase, createPool } from '../client.js';
import { runMigrations } from '../migrate.js';
import { seedReferenceData } from '../seed.js';

/** Deploy step: apply migrations, then bring reference data (roles, categories, …) up to date. */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  process.stderr.write('DATABASE_URL is required\n');
  process.exit(1);
}

const pool = createPool({
  connectionString,
  applicationName: 'lastsize-migrate',
  maxConnections: 1,
});
try {
  const db = createDatabase(pool);
  await runMigrations(db);
  await seedReferenceData(db);
  process.stdout.write('migrations applied, reference data up to date\n');
} catch (error) {
  process.stderr.write(
    `migration failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
