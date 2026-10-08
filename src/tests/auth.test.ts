/**
 * Comprehensive Verification Test Suite for Authentication & Authorization Layer
 * 
 * Verifies:
 * 1. Login with valid credentials (Admin, Partner, Customer)
 * 2. Invalid credentials rejection
 * 3. Inactive user rejection
 * 4. HttpOnly cookie handling and JWT session verification (/api/auth/me)
 * 5. Logout and cookie invalidation
 * 6. Role-based access control (RBAC) enforcement
 * 7. Admin preview / impersonation authorization and audit trail retention
 */

import server from '../server.js';
import { db, sqlClient } from '../db/index.js';
import { partners, customers } from '../db/schema.js';
import { eq } from 'drizzle-orm';

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
  console.log('🧪 RUNNING AUTHENTICATION & AUTHORIZATION TEST SUITE');
  console.log('======================================================\n');

  await server.ready();

  // Retrieve partner and customer IDs for test assertions
  const [partner] = await db.select().from(partners).where(eq(partners.partnerCode, 'PRT-SVEN-01')).limit(1);
  const [customer] = await db.select().from(customers).where(eq(customers.customerNumber, 'CUST-2026-001')).limit(1);

  if (!partner || !customer) {
    throw new Error('Seed data missing. Please run `npm run db:seed` first.');
  }

  // ---------------------------------------------------------
  // 1. TEST LOGIN (VALID CREDENTIALS)
  // ---------------------------------------------------------
  console.log('--- 1. Testing Login (Valid Credentials) ---');
  
  // 1.1 Admin Login
  const adminLoginRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@vanuitambacht.nl', password: 'admin123' },
  });
  const adminCookies = adminLoginRes.headers['set-cookie'] as string | string[] | undefined;
  const adminCookieStr = Array.isArray(adminCookies) ? adminCookies[0] : adminCookies || '';
  const adminBody = JSON.parse(adminLoginRes.body);

  record(
    'Admin Login succeeds with 200 OK',
    adminLoginRes.statusCode === 200 && adminBody.success === true && adminBody.data.user.role === 'admin',
    `User: ${adminBody.data?.user?.fullName}`
  );

  record(
    'Admin Login sets secure HttpOnly cookie (va_auth_token)',
    adminCookieStr.includes('va_auth_token=') && adminCookieStr.toLowerCase().includes('httponly'),
    adminCookieStr.split(';')[0]
  );

  // 1.2 Partner Login
  const partnerLoginRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'partner@vanuitambacht.nl', password: 'partner123' },
  });
  const partnerCookies = partnerLoginRes.headers['set-cookie'] as string | string[] | undefined;
  const partnerCookieStr = Array.isArray(partnerCookies) ? partnerCookies[0] : partnerCookies || '';
  const partnerBody = JSON.parse(partnerLoginRes.body);

  record(
    'Partner Login resolves linked partner profile (partnerCode: PRT-SVEN-01)',
    partnerLoginRes.statusCode === 200 && partnerBody.data.user.partnerCode === 'PRT-SVEN-01',
    `Partner Code: ${partnerBody.data?.user?.partnerCode}`
  );

  // 1.3 Customer Login
  const customerLoginRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'customer@vanuitambacht.nl', password: 'customer123' },
  });
  const customerCookies = customerLoginRes.headers['set-cookie'] as string | string[] | undefined;
  const customerCookieStr = Array.isArray(customerCookies) ? customerCookies[0] : customerCookies || '';
  const customerBody = JSON.parse(customerLoginRes.body);

  record(
    'Customer Login resolves linked customer profile (customerNumber: CUST-2026-001)',
    customerLoginRes.statusCode === 200 && customerBody.data.user.customerNumber === 'CUST-2026-001',
    `Customer Number: ${customerBody.data?.user?.customerNumber}`
  );

  // ---------------------------------------------------------
  // 2. TEST INVALID CREDENTIALS
  // ---------------------------------------------------------
  console.log('\n--- 2. Testing Invalid Credentials ---');

  const wrongPasswordRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@vanuitambacht.nl', password: 'wrongPassword!@#' },
  });
  const wrongPasswordBody = JSON.parse(wrongPasswordRes.body);

  record(
    'Rejects incorrect password with 401 Unauthorized',
    wrongPasswordRes.statusCode === 401 && wrongPasswordBody.error.code === 'INVALID_CREDENTIALS',
    wrongPasswordBody.error.message
  );

  const unknownEmailRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'nonexistent@vanuitambacht.nl', password: 'admin123' },
  });
  const unknownEmailBody = JSON.parse(unknownEmailRes.body);

  record(
    'Rejects unknown email with 401 Unauthorized',
    unknownEmailRes.statusCode === 401 && unknownEmailBody.error.code === 'INVALID_CREDENTIALS',
    unknownEmailBody.error.message
  );

  const invalidPayloadRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'not-an-email', password: '' },
  });
  record(
    'Rejects malformed input payload with 400 Bad Request',
    invalidPayloadRes.statusCode === 400,
    'Zod Validation Guard triggered'
  );

  // ---------------------------------------------------------
  // 3. TEST INACTIVE USERS
  // ---------------------------------------------------------
  console.log('\n--- 3. Testing Inactive User Handling ---');

  const inactiveLoginRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'inactive@vanuitambacht.nl', password: 'inactive123' },
  });
  const inactiveBody = JSON.parse(inactiveLoginRes.body);

  record(
    'Rejects disabled/inactive user with 403 Forbidden',
    inactiveLoginRes.statusCode === 403 && inactiveBody.error.code === 'ACCOUNT_DISABLED',
    inactiveBody.error.message
  );

  // ---------------------------------------------------------
  // 4. TEST JWT & COOKIE SESSION REVALIDATION (/api/auth/me)
  // ---------------------------------------------------------
  console.log('\n--- 4. Testing Session Authentication (/api/auth/me) ---');

  // 4.1 Valid cookie
  const meRes = await server.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: {
      cookie: adminCookieStr,
    },
  });
  const meBody = JSON.parse(meRes.body);
  record(
    'Session revalidation with HttpOnly cookie returns user profile',
    meRes.statusCode === 200 && meBody.data.user.email === 'admin@vanuitambacht.nl',
    `Authenticated as: ${meBody.data?.user?.fullName}`
  );

  // 4.2 Missing cookie / token
  const unauthenticatedRes = await server.inject({
    method: 'GET',
    url: '/api/auth/me',
  });
  record(
    'Rejects request with missing token with 401 Unauthorized',
    unauthenticatedRes.statusCode === 401,
    'UNAUTHENTICATED'
  );

  // 4.3 Tampered / invalid token
  const tamperedRes = await server.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: {
      cookie: 'va_auth_token=tampered_invalid_jwt_signature_xyz;',
    },
  });
  record(
    'Rejects tampered JWT cookie with 401 Unauthorized',
    tamperedRes.statusCode === 401,
    'INVALID_TOKEN'
  );

  // ---------------------------------------------------------
  // 5. TEST LOGOUT
  // ---------------------------------------------------------
  console.log('\n--- 5. Testing Logout ---');

  const logoutRes = await server.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: {
      cookie: adminCookieStr,
    },
  });
  const logoutCookies = logoutRes.headers['set-cookie'] as string | string[] | undefined;
  const logoutCookieStr = Array.isArray(logoutCookies) ? logoutCookies[0] : logoutCookies || '';

  record(
    'Logout endpoint returns 200 OK and clears auth cookie',
    logoutRes.statusCode === 200 && (logoutCookieStr.includes('Expires=Thu, 01 Jan 1970') || logoutCookieStr.includes('Max-Age=0')),
    'Cookie invalidated'
  );

  // ---------------------------------------------------------
  // 6. TEST ROLE-BASED ACCESS CONTROL (RBAC)
  // ---------------------------------------------------------
  console.log('\n--- 6. Testing Role-Based Access Control (RBAC) ---');

  // 6.1 Partner accesses partner route
  const partnerOnPartnerRoute = await server.inject({
    method: 'GET',
    url: '/api/auth/test/partner-only',
    headers: { cookie: partnerCookieStr },
  });
  record(
    'Partner role accesses partner-only route (200 OK)',
    partnerOnPartnerRoute.statusCode === 200,
    'Granted'
  );

  // 6.2 Partner tries to access admin route
  const partnerOnAdminRoute = await server.inject({
    method: 'GET',
    url: '/api/auth/test/admin-only',
    headers: { cookie: partnerCookieStr },
  });
  record(
    'Partner role is blocked from admin route with 403 Forbidden',
    partnerOnAdminRoute.statusCode === 403,
    'Blocked'
  );

  // 6.3 Customer accesses customer route
  const customerOnCustomerRoute = await server.inject({
    method: 'GET',
    url: '/api/auth/test/customer-only',
    headers: { cookie: customerCookieStr },
  });
  record(
    'Customer role accesses customer-only route (200 OK)',
    customerOnCustomerRoute.statusCode === 200,
    'Granted'
  );

  // 6.4 Customer tries to access partner route
  const customerOnPartnerRoute = await server.inject({
    method: 'GET',
    url: '/api/auth/test/partner-only',
    headers: { cookie: customerCookieStr },
  });
  record(
    'Customer role is blocked from partner route with 403 Forbidden',
    customerOnPartnerRoute.statusCode === 403,
    'Blocked'
  );

  // 6.5 Admin accesses admin route
  const adminOnAdminRoute = await server.inject({
    method: 'GET',
    url: '/api/auth/test/admin-only',
    headers: { cookie: adminCookieStr },
  });
  record(
    'Admin role accesses admin-only route (200 OK)',
    adminOnAdminRoute.statusCode === 200,
    'Granted'
  );

  // ---------------------------------------------------------
  // 7. TEST ADMIN PREVIEW / IMPERSONATION AUTHORIZATION
  // ---------------------------------------------------------
  console.log('\n--- 7. Testing Admin Preview / Impersonation ---');

  // 7.1 Non-admin attempts to use impersonation headers
  const partnerAttemptImpersonate = await server.inject({
    method: 'GET',
    url: '/api/auth/test/customer-only',
    headers: {
      cookie: partnerCookieStr,
      'x-impersonate-role': 'customer',
      'x-impersonate-id': customer.id,
    },
  });
  const partnerImpersonateBody = JSON.parse(partnerAttemptImpersonate.body);
  record(
    'Non-admin cannot impersonate (403 Forbidden)',
    partnerAttemptImpersonate.statusCode === 403 && partnerImpersonateBody.error.code === 'IMPERSONATION_FORBIDDEN',
    partnerImpersonateBody.error.message
  );

  // 7.2 Admin without impersonation cannot access partner route directly
  const adminDirectPartnerRoute = await server.inject({
    method: 'GET',
    url: '/api/auth/test/partner-only',
    headers: { cookie: adminCookieStr },
  });
  record(
    'Admin without impersonation header cannot bypass strict partner guard (403 Forbidden)',
    adminDirectPartnerRoute.statusCode === 403,
    'Prevents accidental privilege bleed'
  );

  // 7.3 Admin with explicit partner preview headers
  const adminPreviewPartner = await server.inject({
    method: 'GET',
    url: '/api/auth/test/partner-only',
    headers: {
      cookie: adminCookieStr,
      'x-impersonate-role': 'partner',
      'x-impersonate-id': partner.id,
    },
  });
  const adminPreviewBody = JSON.parse(adminPreviewPartner.body);
  const auditPreserved = adminPreviewBody.user?.email === 'admin@vanuitambacht.nl';
  const previewActive = adminPreviewBody.impersonation?.active === true && adminPreviewBody.impersonation?.targetRole === 'partner';

  record(
    'Admin can preview partner portal with explicit impersonation headers (200 OK)',
    adminPreviewPartner.statusCode === 200 && previewActive && auditPreserved,
    `Admin (${adminPreviewBody.user?.email}) previewing as Partner: ${adminPreviewBody.impersonation?.targetName}`
  );

  // 7.4 Admin with invalid target ID
  const adminInvalidTarget = await server.inject({
    method: 'GET',
    url: '/api/auth/test/partner-only',
    headers: {
      cookie: adminCookieStr,
      'x-impersonate-role': 'partner',
      'x-impersonate-id': '00000000-0000-0000-0000-000000000000',
    },
  });
  record(
    'Admin preview fails if target partner ID does not exist (404 Not Found)',
    adminInvalidTarget.statusCode === 404,
    'Target entity validated against DB'
  );

  // ---------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------
  console.log('\n======================================================');
  const allPassed = results.every((r) => r.passed);
  console.log(`🏁 TEST RUN FINISHED: ${results.filter((r) => r.passed).length}/${results.length} TESTS PASSED`);
  console.log('======================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
}

runTests()
  .catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await server.close();
    await sqlClient.end();
  });
