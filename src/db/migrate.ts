import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

function getDbOptions() {
  const urlStr = process.env.DATABASE_URL || 'postgresql://postgres:123456@localhost:5432/vanuit%20ambacht';
  try {
    const parsed = new URL(urlStr);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    return {
      host: parsed.hostname || 'localhost',
      port: Number(parsed.port) || 5432,
      username: decodeURIComponent(parsed.username || 'postgres'),
      password: decodeURIComponent(parsed.password || '123456'),
      database: decodeURIComponent(parsed.pathname.slice(1)) || 'vanuit ambacht',
      ssl: isLocal ? false : { rejectUnauthorized: false },
    };
  } catch {
    return {
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: '123456',
      database: 'vanuit ambacht',
      ssl: false,
    };
  }
}

async function runMigration() {
  const opts = getDbOptions();
  console.log(`🔄 Connecting to PostgreSQL database: "${opts.database}" on ${opts.host}:${opts.port}...`);
  
  const migrationClient = postgres({
    ...opts,
    max: 1,
  });

  const db = drizzle(migrationClient);

  console.log('🚀 Running Drizzle migrations from ./drizzle ...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('✅ Migrations applied successfully.');

  // Create or Replace SQL Verification View for Unbalanced Journal Entries
  console.log('📊 Ensuring SQL view: view_unbalanced_journal_entries ...');
  await migrationClient`
    CREATE OR REPLACE VIEW view_unbalanced_journal_entries AS
    SELECT 
      je.id AS journal_entry_id,
      je.entry_number,
      je.entry_date,
      je.entry_type,
      COALESCE(SUM(jel.debit), 0) AS total_debit,
      COALESCE(SUM(jel.credit), 0) AS total_credit,
      (COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)) AS imbalance_amount
    FROM journal_entries je
    LEFT JOIN journal_entry_lines jel ON je.id = jel.journal_entry_id
    GROUP BY je.id, je.entry_number, je.entry_date, je.entry_type
    HAVING COALESCE(SUM(jel.debit), 0) != COALESCE(SUM(jel.credit), 0);
  `;
  console.log('✅ SQL verification view created.');

  await migrationClient.end();
  console.log('🎉 Database migration routine complete!');
}

runMigration().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
