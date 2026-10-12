import { db } from './db/index.js';
import { quotes, leads } from './db/schema.js';
import { desc } from 'drizzle-orm';

async function main() {
  const allQuotes = await db.select().from(quotes).orderBy(desc(quotes.createdAt));
  console.log('Total quotes in DB:', allQuotes.length);
  for (const q of allQuotes) {
    console.log(`ID: ${q.id} | Num: ${q.quoteNumber} | Lead: ${q.leadId} | Cust: ${q.customerId} | Status: ${q.status} | Created: ${q.createdAt}`);
  }
  
  const allLeads = await db.select().from(leads).orderBy(desc(leads.createdAt));
  console.log('\nTotal leads in DB:', allLeads.length);
  for (const l of allLeads) {
    console.log(`Lead ID: ${l.id} | Name: ${l.name} | Status: ${l.status}`);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
