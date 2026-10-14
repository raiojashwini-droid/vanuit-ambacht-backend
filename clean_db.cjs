const postgres = require('postgres');

async function clean() {
  const sql = postgres('postgresql://postgres:qaScdTPfeCojYRVodqsBKLDasKzeOYox@altaria.proxy.rlwy.net:26208/railway', {
    ssl: { rejectUnauthorized: false }
  });

  console.log('--- Cleaning developer test data from DB ---');

  // 1. Delete invoice items & invoices
  await sql.unsafe('DELETE FROM invoice_items');
  await sql.unsafe('DELETE FROM invoices');
  console.log('✓ Cleaned invoices & invoice_items');

  // 2. Delete project photos & projects
  await sql.unsafe('DELETE FROM project_photos');
  await sql.unsafe('DELETE FROM projects');
  console.log('✓ Cleaned projects & project_photos');

  // 3. Delete quote items, quote versions & quotes
  await sql.unsafe('DELETE FROM quote_items');
  await sql.unsafe('DELETE FROM quote_versions');
  await sql.unsafe('DELETE FROM quotes');
  console.log('✓ Cleaned quotes, versions & items');

  // 4. Delete partner offers & price requests
  await sql.unsafe('DELETE FROM partner_offers');
  await sql.unsafe('DELETE FROM partner_price_requests');
  console.log('✓ Cleaned partner offers & price requests');

  // 5. Delete commercial actions & leads
  await sql.unsafe('DELETE FROM commercial_actions');
  await sql.unsafe('DELETE FROM leads');
  console.log('✓ Cleaned leads & commercial actions');

  // 6. Delete partner candidates
  await sql.unsafe('DELETE FROM partner_candidates');
  console.log('✓ Cleaned partner_candidates');

  // 7. Delete test partners (keep Sven Hoek - Hoek Ambachtelijke Houtbouw)
  await sql.unsafe("DELETE FROM partners WHERE email NOT IN ('partner@vanuitambacht.nl')");
  console.log('✓ Cleaned test partners');

  // 8. Delete test users (keep admin, partner, customer seeds, and Tim & Bram)
  await sql.unsafe("DELETE FROM users WHERE email NOT IN ('admin@vanuitambacht.nl', 'partner@vanuitambacht.nl', 'customer@vanuitambacht.nl', 'tim@vanuitambacht.nl', 'bram@vanuitambacht.nl')");
  console.log('✓ Cleaned test users');

  // 9. Delete test customers created during quote testing
  await sql.unsafe("DELETE FROM customers WHERE email NOT IN ('customer@vanuitambacht.nl')");
  console.log('✓ Cleaned test customers');

  // Verify remaining counts
  const [candidates] = await sql.unsafe('SELECT count(*) FROM partner_candidates');
  const [leads] = await sql.unsafe('SELECT count(*) FROM leads');
  const [quotes] = await sql.unsafe('SELECT count(*) FROM quotes');
  const [projects] = await sql.unsafe('SELECT count(*) FROM projects');
  const [partners] = await sql.unsafe('SELECT count(*) FROM partners');

  console.log('--- Remaining DB counts ---');
  console.log('Candidates:', candidates.count);
  console.log('Leads:', leads.count);
  console.log('Quotes:', quotes.count);
  console.log('Projects:', projects.count);
  console.log('Partners:', partners.count);

  await sql.end();
  console.log('--- DB cleanup complete ---');
  process.exit(0);
}

clean().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
