import postgres from 'postgres';

async function test() {
  const connStr = 'postgresql://postgres:qaScdTPfeCojYRVodqsBKLDasKzeOYox@altaria.proxy.rlwy.net:26208/railway';
  console.log('Connecting to Railway DB...');
  const sql = postgres(connStr, { ssl: 'prefer', connect_timeout: 10 });
  try {
    const res = await sql`SELECT count(*) FROM leads;`;
    console.log('SUCCESS! Leads count:', res[0].count);
  } catch (err: any) {
    console.error('Error connecting:', err.message);
  } finally {
    await sql.end();
  }
}

test();
