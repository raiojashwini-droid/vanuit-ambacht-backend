import { db } from './db/index.js';
import { quotes, quoteVersions, quoteItems } from './db/schema.js';
import { eq, inArray } from 'drizzle-orm';

async function main() {
  // Find all quotes from Q-2026-004 to Q-2026-022 (keep Q-2026-023 as the 1 legitimate quote for demotets2)
  const allQuotes = await db.select().from(quotes);
  
  // We want to delete duplicate drafts Q-2026-004 through Q-2026-022
  const duplicatesToDelete = allQuotes.filter(q => {
    const num = q.quoteNumber;
    // Delete drafts Q-2026-004 to Q-2026-022
    if (/^Q-2026-0(0[4-9]|1[0-9]|2[0-2])$/.test(num)) {
      return true;
    }
    return false;
  });

  console.log(`Found ${duplicatesToDelete.length} duplicate test quotes to delete:`);
  for (const q of duplicatesToDelete) {
    console.log(`- ${q.quoteNumber} (ID: ${q.id})`);
  }

  for (const q of duplicatesToDelete) {
    const versions = await db.select({ id: quoteVersions.id }).from(quoteVersions).where(eq(quoteVersions.quoteId, q.id));
    const vIds = versions.map(v => v.id);
    if (vIds.length > 0) {
      await db.delete(quoteItems).where(inArray(quoteItems.quoteVersionId, vIds));
      await db.delete(quoteVersions).where(eq(quoteVersions.quoteId, q.id));
    }
    await db.delete(quotes).where(eq(quotes.id, q.id));
    console.log(`✓ Deleted ${q.quoteNumber}`);
  }

  const remaining = await db.select().from(quotes);
  console.log(`\nRemaining quotes in DB: ${remaining.length}`);
  for (const r of remaining) {
    console.log(`- ${r.quoteNumber} | Status: ${r.status} | Lead: ${r.leadId}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
