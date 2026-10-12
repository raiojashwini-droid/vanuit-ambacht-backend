import { db } from './db/index.js';
import { quotes, quoteVersions, quoteItems, leads } from './db/schema.js';
import { desc, eq } from 'drizzle-orm';

async function main() {
  const allQuotes = await db.select().from(quotes).orderBy(desc(quotes.createdAt));
  console.log('Total quotes in DB:', allQuotes.length);
  for (const q of allQuotes) {
    const versions = await db.select().from(quoteVersions).where(eq(quoteVersions.quoteId, q.id));
    const items = await db.select().from(quoteItems).where(eq(quoteItems.quoteVersionId, versions[0]?.id || '00000000-0000-0000-0000-000000000000'));
    console.log(`Quote: ${q.quoteNumber} | Status: ${q.status} | Lead: ${q.leadId} | Cust: ${q.customerId} | Items: ${items.length} | Total: ${versions[0]?.totalInclVat} | Created: ${q.createdAt}`);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
