import server from '../server.js';
import { db, sqlClient } from '../db/index.js';
import { partners, users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, details = '') {
  results.push({ name, passed, details });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon}: ${name}${details ? ` -> ${details}` : ''}`);
}

async function run() {
  console.log('======================================================');
  console.log('🧪 RUNNING PARTNER WORKLOAD & AVAILABILITY TEST SUITE');
  console.log('======================================================\n');

  await server.ready();

  function extractCookie(res: any): string {
    const raw = res.headers['set-cookie'];
    if (!raw) return '';
    return Array.isArray(raw) ? raw[0] : (raw as string);
  }

  // 1. Login as Admin
  const adminLoginRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@vanuitambacht.nl', password: 'admin123' },
  });
  const adminCookie = extractCookie(adminLoginRes);
  record('Admin login succeeds', adminLoginRes.statusCode === 200);

  // 2. Fetch existing partners to test with
  const partnerRows = await db.select().from(partners).limit(2);
  if (partnerRows.length < 2) {
    console.error('Need at least 2 partners in DB for isolation tests');
    return;
  }

  const p1 = partnerRows[0];
  const p2 = partnerRows[1];

  // 3. Test GET /api/partner/workload (Admin impersonating/resolving first partner)
  const getWorkloadRes = await server.inject({
    method: 'GET',
    url: '/api/partner/workload',
    headers: { cookie: adminCookie },
  });
  const getWorkloadBody = JSON.parse(getWorkloadRes.body);
  record(
    'GET /api/partner/workload returns workload & availableWeeks',
    getWorkloadRes.statusCode === 200 && Array.isArray(getWorkloadBody.data.availableWeeks),
    `Status: ${getWorkloadBody.data?.workloadStatus}, Weeks: [${getWorkloadBody.data?.availableWeeks?.join(', ')}]`
  );

  // 4. Test PATCH /api/partner/workload updating status and available calendar weeks
  const testWeeks = [42, 43, 44, 45];
  const patchWorkloadRes = await server.inject({
    method: 'PATCH',
    url: '/api/partner/workload',
    headers: { cookie: adminCookie },
    payload: {
      workloadStatus: 'available',
      availableWeeks: testWeeks,
    },
  });
  const patchWorkloadBody = JSON.parse(patchWorkloadRes.body);
  record(
    'PATCH /api/partner/workload updates status and available weeks',
    patchWorkloadRes.statusCode === 200 &&
      patchWorkloadBody.data.workloadStatus === 'available' &&
      JSON.stringify(patchWorkloadBody.data.availableWeeks) === JSON.stringify(testWeeks),
    `Updated status: ${patchWorkloadBody.data?.workloadStatus}, Weeks: [${patchWorkloadBody.data?.availableWeeks?.join(', ')}]`
  );

  // 5. Test PATCH /api/partners/:id/workload with weeks
  const updateViaIdRes = await server.inject({
    method: 'PATCH',
    url: `/api/partners/${p1.id}/workload`,
    headers: { cookie: adminCookie },
    payload: {
      workloadStatus: 'busy',
      availableWeeks: [44, 45, 46],
    },
  });
  const updateViaIdBody = JSON.parse(updateViaIdRes.body);
  record(
    'Admin updates partner workload & weeks via /api/partners/:id/workload',
    updateViaIdRes.statusCode === 200 &&
      updateViaIdBody.data.workloadStatus === 'busy' &&
      updateViaIdBody.data.availableWeeks?.includes(46),
    `Status: ${updateViaIdBody.data?.workloadStatus}, Weeks: [${updateViaIdBody.data?.availableWeeks?.join(', ')}]`
  );

  // 6. Test Partner Dossier includes availableWeeks
  const dossierRes = await server.inject({
    method: 'GET',
    url: `/api/partners/${p1.id}`,
    headers: { cookie: adminCookie },
  });
  const dossierBody = JSON.parse(dossierRes.body);
  record(
    'GET /api/partners/:id includes availableWeeks in dossier',
    dossierRes.statusCode === 200 && Array.isArray(dossierBody.data?.availableWeeks),
    `Dossier Weeks: [${dossierBody.data?.availableWeeks?.join(', ')}]`
  );

  // 7. Security: Partner login & isolation
  const partnerLoginRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'partner@vanuitambacht.nl', password: 'partner123' },
  });
  const partnerCookie = extractCookie(partnerLoginRes);
  const partnerUserBody = JSON.parse(partnerLoginRes.body);
  record('Partner login succeeds', partnerLoginRes.statusCode === 200);

  const myPartnerId = partnerUserBody.data?.user?.profileId;
  if (myPartnerId) {
    // Partner updates their own workload
    const selfUpdateRes = await server.inject({
      method: 'PATCH',
      url: `/api/partners/${myPartnerId}/workload`,
      headers: { cookie: partnerCookie },
      payload: { workloadStatus: 'available', availableWeeks: [42, 43] },
    });
    record('Partner can update their own workload via PATCH /:id/workload (200 OK)', selfUpdateRes.statusCode === 200);

    // Partner updates via self-service endpoint /api/partner/workload
    const selfEndpointRes = await server.inject({
      method: 'PATCH',
      url: '/api/partner/workload',
      headers: { cookie: partnerCookie },
      payload: { workloadStatus: 'busy', availableWeeks: [43, 44] },
    });
    record('Partner can update their own workload via PATCH /api/partner/workload (200 OK)', selfEndpointRes.statusCode === 200);

    // Find another partner ID
    const otherPartner = partnerRows.find(p => p.id !== myPartnerId);
    if (otherPartner) {
      const crossUpdateRes = await server.inject({
        method: 'PATCH',
        url: `/api/partners/${otherPartner.id}/workload`,
        headers: { cookie: partnerCookie },
        payload: { workloadStatus: 'inactive' },
      });
      record(
        'Security check: Partner CANNOT update another partner workload (403 Forbidden)',
        crossUpdateRes.statusCode === 403,
        `Status: ${crossUpdateRes.statusCode}`
      );
    }
  }

  console.log('\n======================================================');
  const allPassed = results.every(r => r.passed);
  console.log(`🏁 PARTNER WORKLOAD TEST COMPLETED: ${results.filter(r => r.passed).length}/${results.length} PASSED`);
  console.log('======================================================\n');

  await sqlClient.end();
  process.exit(allPassed ? 0 : 1);
}

run().catch(console.error);
