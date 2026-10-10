/**
 * Automated Test Suite: Prospective Partner Pipeline & Candidates Module
 *
 * Verifies:
 * - Admin-only authorization & authentication protection (401/403)
 * - Candidate creation with auto-numbering (CAND-YYYY-XXX)
 * - Retrieval and stage counts calculation
 * - Kanban stage transitions (interested -> in_discussion -> trial_project -> active -> rejected)
 * - Duplicate candidate prevention
 * - Atomic transactional candidate-to-partner conversion:
 *   * Generates partner code
 *   * Hashes password & creates user record
 *   * Creates official partner profile
 *   * Sets candidate convertedPartnerId & convertedAt
 * - Converted partner login authentication verification
 * - Duplicate conversion prevention (409 Conflict)
 */

import server from '../server.js';
import { db, sqlClient } from '../db/index.js';
import { partnerCandidates, partners, users } from '../db/schema.js';
import { eq, ilike } from 'drizzle-orm';

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

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING PARTNER CANDIDATES PIPELINE TEST SUITE');
  console.log('======================================================\n');

  await server.ready();

  function extractCookie(res: any): string {
    const raw = res.headers['set-cookie'];
    if (!raw) return '';
    return Array.isArray(raw) ? raw[0] : (raw as string);
  }

  // 1. Obtain Authentication Cookies
  const adminLoginRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@vanuitambacht.nl', password: 'admin123' },
  });
  const adminCookie = extractCookie(adminLoginRes);

  const partnerLoginRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'partner@vanuitambacht.nl', password: 'partner123' },
  });
  const partnerCookie = extractCookie(partnerLoginRes);

  record('Admin login for test runner', adminLoginRes.statusCode === 200, `Status ${adminLoginRes.statusCode}`);
  record('Partner login for test runner', partnerLoginRes.statusCode === 200, `Status ${partnerLoginRes.statusCode}`);

  // Test 1: Unauthenticated request should return 401
  const unauthRes = await server.inject({
    method: 'GET',
    url: '/api/partner-candidates',
  });
  record('Auth Guard: Reject unauthenticated request', unauthRes.statusCode === 401, `Status ${unauthRes.statusCode}`);

  // Test 2: Non-admin (Partner) request should return 403 Forbidden
  const forbiddenRes = await server.inject({
    method: 'GET',
    url: '/api/partner-candidates',
    headers: { cookie: partnerCookie },
  });
  record('Auth Guard: Reject non-admin role with 403', forbiddenRes.statusCode === 403, `Status ${forbiddenRes.statusCode}`);

  // Test 3: Admin can access candidates endpoint
  const adminListRes = await server.inject({
    method: 'GET',
    url: '/api/partner-candidates',
    headers: { cookie: adminCookie },
  });
  record('Auth Guard: Allow admin access', adminListRes.statusCode === 200, `Status ${adminListRes.statusCode}`);

  // Test 4: Create prospective candidate in pipeline
  const testEmail = `cand_${Date.now()}@example.nl`;
  const createRes = await server.inject({
    method: 'POST',
    url: '/api/partner-candidates',
    headers: { cookie: adminCookie },
    payload: {
      name: 'Lars van Dijk',
      companyName: 'Van Dijk Houtbewerking',
      email: testEmail,
      phone: '+31 6 11223344',
      region: 'Utrecht',
      stage: 'interested',
      notes: 'Initial outreach through web contact form',
      specialties: ['Buitenkeukens', 'Eiken constructies'],
      productTypes: ['outdoor_kitchen', 'garden_room'],
      kvkNumber: '87654321',
      btwNumber: 'NL87654321B01',
    },
  });

  const createdBody = JSON.parse(createRes.payload);
  const candidateId = createdBody.data?.id;
  const candidateNum = createdBody.data?.candidateNumber;

  record(
    'Candidate Creation: Returns 201 with candidateNumber',
    createRes.statusCode === 201 && candidateNum?.startsWith('CAND-'),
    `Number: ${candidateNum}`
  );

  // Test 5: Duplicate active candidate with same email should be rejected (409)
  const duplicateRes = await server.inject({
    method: 'POST',
    url: '/api/partner-candidates',
    headers: { cookie: adminCookie },
    payload: {
      name: 'Lars Duplicate',
      email: testEmail,
      phone: '+31 6 99887766',
    },
  });
  record(
    'Duplicate Prevention: Rejects duplicate candidate email with 409',
    duplicateRes.statusCode === 409,
    `Status ${duplicateRes.statusCode}`
  );

  // Test 6: Advance candidate through Kanban stages
  const stageDiscussionRes = await server.inject({
    method: 'PATCH',
    url: `/api/partner-candidates/${candidateId}/stage`,
    headers: { cookie: adminCookie },
    payload: { stage: 'in_discussion', notes: 'Phone screening completed on Monday.' },
  });
  const discussionBody = JSON.parse(stageDiscussionRes.payload);
  record(
    'Stage Transition: Move to in_discussion',
    stageDiscussionRes.statusCode === 200 && discussionBody.data?.stage === 'in_discussion',
    `Stage: ${discussionBody.data?.stage}`
  );

  const stageTrialRes = await server.inject({
    method: 'PATCH',
    url: `/api/partner-candidates/${candidateId}/stage`,
    headers: { cookie: adminCookie },
    payload: { stage: 'trial_project', notes: 'Sample joinery panel requested.' },
  });
  const trialBody = JSON.parse(stageTrialRes.payload);
  record(
    'Stage Transition: Move to trial_project',
    stageTrialRes.statusCode === 200 && trialBody.data?.stage === 'trial_project',
    `Stage: ${trialBody.data?.stage}`
  );

  const stageActiveRes = await server.inject({
    method: 'PATCH',
    url: `/api/partner-candidates/${candidateId}/stage`,
    headers: { cookie: adminCookie },
    payload: { stage: 'active', notes: 'Trial passed with 5-star quality rating.' },
  });
  const activeBody = JSON.parse(stageActiveRes.payload);
  record(
    'Stage Transition: Move to active candidate',
    stageActiveRes.statusCode === 200 && activeBody.data?.stage === 'active',
    `Stage: ${activeBody.data?.stage}`
  );

  // Test 7: Atomic Transactional Conversion to Official Partner
  const convertPassword = 'SecretCraftsman2026!';
  const convertRes = await server.inject({
    method: 'POST',
    url: `/api/partner-candidates/${candidateId}/convert`,
    headers: { cookie: adminCookie },
    payload: {
      password: convertPassword,
      companyName: 'Van Dijk Ambachtelijke Meubels BV',
      kvkNumber: '87654321',
      btwNumber: 'NL87654321B01',
      workloadStatus: 'available',
    },
  });

  const convertBody = JSON.parse(convertRes.payload);
  const convertedPartner = convertBody.data?.partner;
  const updatedCandidate = convertBody.data?.candidate;

  record(
    'Atomic Conversion: Converts candidate and returns partnerCode',
    convertRes.statusCode === 201 && convertedPartner?.partnerCode?.startsWith('PRT-'),
    `PartnerCode: ${convertedPartner?.partnerCode}`
  );

  record(
    'Linkage Verification: Candidate has convertedPartnerId set',
    updatedCandidate?.convertedPartnerId === convertedPartner?.id && !!updatedCandidate?.convertedAt,
    `Converted Partner ID: ${updatedCandidate?.convertedPartnerId}`
  );

  // Test 8: Converted Partner can log in immediately with set credentials
  const newPartnerLoginRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: {
      email: testEmail,
      password: convertPassword,
    },
  });
  const newPartnerLoginBody = JSON.parse(newPartnerLoginRes.payload);
  record(
    'Partner Portal Authentication: Newly converted partner logs in successfully',
    newPartnerLoginRes.statusCode === 200 && newPartnerLoginBody.data?.user?.role === 'partner',
    `Role: ${newPartnerLoginBody.data?.user?.role}, Profile: ${newPartnerLoginBody.data?.user?.profileId}`
  );

  // Test 9: Duplicate Conversion Prevention (Attempting to convert again returns 409)
  const duplicateConvertRes = await server.inject({
    method: 'POST',
    url: `/api/partner-candidates/${candidateId}/convert`,
    headers: { cookie: adminCookie },
    payload: {
      password: 'AnotherPassword123!',
    },
  });
  record(
    'Duplicate Conversion Guard: Rejects second conversion with 409',
    duplicateConvertRes.statusCode === 409,
    `Status ${duplicateConvertRes.statusCode}`
  );

  // Test 10: Create and move candidate to 'rejected' stage
  const rejectEmail = `rejected_${Date.now()}@example.nl`;
  const rejectCandRes = await server.inject({
    method: 'POST',
    url: '/api/partner-candidates',
    headers: { cookie: adminCookie },
    payload: {
      name: 'Unqualified Builder',
      email: rejectEmail,
      phone: '+31 6 00001111',
      stage: 'interested',
    },
  });
  const rejectCandId = JSON.parse(rejectCandRes.payload).data?.id;

  const markRejectRes = await server.inject({
    method: 'PATCH',
    url: `/api/partner-candidates/${rejectCandId}/stage`,
    headers: { cookie: adminCookie },
    payload: { stage: 'rejected', notes: 'Does not meet insurance requirements.' },
  });
  const markRejectBody = JSON.parse(markRejectRes.payload);
  record(
    'Stage Transition: Successfully moves to rejected stage',
    markRejectRes.statusCode === 200 && markRejectBody.data?.stage === 'rejected',
    `Stage: ${markRejectBody.data?.stage}`
  );

  // Clean up created test records from database
  try {
    if (rejectCandId) {
      await db.delete(partnerCandidates).where(eq(partnerCandidates.id, rejectCandId));
    }
    if (candidateId) {
      await db.delete(partnerCandidates).where(eq(partnerCandidates.id, candidateId));
    }
    if (convertedPartner?.id) {
      await db.delete(partners).where(eq(partners.id, convertedPartner.id));
    }
    await db.delete(users).where(eq(users.email, testEmail.toLowerCase()));
  } catch (cleanErr) {
    console.warn('Test cleanup note:', cleanErr);
  }

  // Summary
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  console.log('\n======================================================');
  console.log(`🏁 PARTNER CANDIDATES SUITE COMPLETE: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('======================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests()
  .then(() => {
    sqlClient.end();
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal test runner failure:', err);
    sqlClient.end();
    process.exit(1);
  });
