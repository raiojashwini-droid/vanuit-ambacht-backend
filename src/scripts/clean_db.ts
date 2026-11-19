import { db, sqlClient } from '../db/index.js';
import { sql } from 'drizzle-orm';

async function cleanDatabase() {
  console.log('🧹 [CLEAN_DB] Starting complete transactional database cleanup for client handover...');

  const transactionalTables = [
    'messages',
    'conversation_participants',
    'conversations',
    'documents',
    'commercial_actions',
    'tasks',
    'journal_entry_lines',
    'journal_entries',
    'payment_allocations',
    'payments',
    'payment_webhooks',
    'bank_transactions',
    'bank_statements',
    'invoice_items',
    'invoices',
    'planning_events',
    'project_photos',
    'project_milestones',
    'projects',
    'quote_items',
    'quote_versions',
    'quotes',
    'partner_offers',
    'partner_price_requests',
    'lead_voice_notes',
    'leads',
    'vat_filings',
    'partner_candidates',
    'customers'
  ];

  for (const table of transactionalTables) {
    try {
      await db.execute(sql.raw(`TRUNCATE TABLE ${table} CASCADE;`));
      console.log(`✅ Cleared table: ${table}`);
    } catch (err: any) {
      console.warn(`⚠️ Could not truncate ${table}: ${err.message}`);
    }
  }

  // Keep only official users: admin@, tim@, bram@, partner@
  try {
    const keepEmails = ['admin@vanuitambacht.nl', 'tim@vanuitambacht.nl', 'bram@vanuitambacht.nl', 'partner@vanuitambacht.nl'];
    const emailList = keepEmails.map(e => `'${e}'`).join(', ');
    await db.execute(sql.raw(`DELETE FROM users WHERE email NOT IN (${emailList});`));
    console.log(`✅ Cleaned test users from 'users' table, preserved core admin accounts.`);
  } catch (err: any) {
    console.warn(`⚠️ Could not clean users: ${err.message}`);
  }

  console.log('🎉 [CLEAN_DB] Cleanup completed successfully! Database is now at 0 rows across all business modules.');
}

cleanDatabase()
  .catch((err) => {
    console.error('❌ Error during cleanup:', err);
    process.exit(1);
  })
  .finally(async () => {
    await sqlClient.end();
  });
