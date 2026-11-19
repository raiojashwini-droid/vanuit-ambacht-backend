import { db, sqlClient } from '../db/index.js';
import { sql } from 'drizzle-orm';

async function main() {
  const tables = [
    'leads',
    'partner_requests',
    'partner_offers',
    'quotes',
    'quote_versions',
    'projects',
    'project_milestones',
    'project_photos',
    'planning_events',
    'invoices',
    'invoice_items',
    'payments',
    'bank_transactions',
    'journal_entries',
    'journal_lines',
    'documents',
    'tasks',
    'conversations',
    'messages',
    'activity_logs',
    'audit_logs',
    'partner_candidates',
    'customers',
    'partners',
    'users'
  ];

  console.log('--- CURRENT DATABASE ROW COUNTS ---');
  for (const table of tables) {
    try {
      const res = await db.execute(sql.raw(`SELECT count(*)::int as count FROM ${table}`));
      const cnt = (res as any)[0]?.count ?? 0;
      console.log(`${table.padEnd(25)}: ${cnt}`);
    } catch (err: any) {
      console.log(`${table.padEnd(25)}: ERROR (${err.message})`);
    }
  }

  const uRes = await db.execute(sql.raw(`SELECT email, role, full_name FROM users`));
  console.log('REMAINING USERS:', uRes);
}

main()
  .catch(console.error)
  .finally(async () => {
    await sqlClient.end();
  });
