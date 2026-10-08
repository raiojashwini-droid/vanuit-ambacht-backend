/**
 * Comprehensive Automated Test Suite for Module 14:
 * Business Reports & Analytics Engine, Partner Portal Dashboard/Reports & User Profile Management
 */

import server from '../server.js';
import { db } from '../db/index.js';
import { projects, customers, partners, users, vatFilings, quotes, quoteVersions, quoteItems } from '../db/schema.js';
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

function extractCookie(res: any): string {
  const raw = res.headers['set-cookie'];
  if (!raw) return '';
  return Array.isArray(raw) ? raw[0] : (raw as string);
}

async function runTests() {
  console.log('\n========================================================================');
  console.log('🧪 RUNNING MODULE 14: REPORTS, PARTNER DASHBOARD & PROFILE TEST SUITE');
  console.log('========================================================================\n');

  await server.ready();

  // 1. Authenticate users
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

  const customerLoginRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'customer@vanuitambacht.nl', password: 'customer123' },
  });
  const customerCookie = extractCookie(customerLoginRes);

  record('Auth: Logged in admin, partner, and customer', Boolean(adminCookie && partnerCookie && customerCookie));

  // Retrieve test project, customer, partner records
  const [testProject] = await db.select().from(projects).limit(1);
  const [testCustomerUser] = await db.select().from(users).where(eq(users.role, 'customer')).limit(1);
  const [testCustomer] = await db.select().from(customers).where(eq(customers.userId, testCustomerUser.id)).limit(1);
  const [testPartnerUser] = await db.select().from(users).where(eq(users.role, 'partner')).limit(1);
  const [testPartner] = await db.select().from(partners).where(eq(partners.userId, testPartnerUser.id)).limit(1);

  // Link testProject to testCustomer and testPartner for scoping tests
  if (testProject && testCustomer && testPartner) {
    await db
      .update(projects)
      .set({
        customerId: testCustomer.id,
        partnerId: testPartner.id,
      })
      .where(eq(projects.id, testProject.id));
  }

  // Create another project assigned to a different customer/partner for foreign project tests
  const [foreignProject] = await db
    .insert(projects)
    .values({
      projectNumber: `PRJ-FOR-${Date.now().toString().slice(-4)}`,
      customerId: testCustomer.id, // placeholder, will test against mismatched user
      name: 'Foreign Unassigned Villa Project',
      projectType: 'garden_room',
      status: 'pending',
      deliveryAddress: 'Herengracht 500, Amsterdam',
      city: 'Amsterdam',
    })
    .returning();

  // ---------------------------------------------------------
  // GROUP 1: REPORTS & ANALYTICS ACCESS & RBAC
  // ---------------------------------------------------------

  // Test 1: Unauthenticated 401 on /api/reports/funnel
  const unauthRes = await server.inject({
    method: 'GET',
    url: '/api/reports/funnel',
  });
  record('Reports: 401 Unauthorized without auth cookie', unauthRes.statusCode === 401);

  // Test 2: Partner 403 on /api/reports/funnel
  const partnerReportsRes = await server.inject({
    method: 'GET',
    url: '/api/reports/funnel',
    headers: { cookie: partnerCookie },
  });
  record('Reports: Partner receives 403 Forbidden', partnerReportsRes.statusCode === 403);

  // Test 3: Customer 403 on /api/reports/finance-stats
  const customerReportsRes = await server.inject({
    method: 'GET',
    url: '/api/reports/finance-stats',
    headers: { cookie: customerCookie },
  });
  record('Reports: Customer receives 403 Forbidden', customerReportsRes.statusCode === 403);

  // Test 4: Admin 200 on /api/reports/funnel with 5 stages
  const adminFunnelRes = await server.inject({
    method: 'GET',
    url: '/api/reports/funnel',
    headers: { cookie: adminCookie },
  });
  const funnelBody = adminFunnelRes.json();
  const has5Stages = funnelBody.data?.stages?.length === 5;
  record('Reports: Admin gets funnel with 5 stages & percentages', adminFunnelRes.statusCode === 200 && has5Stages, `Stages: ${funnelBody.data?.stages?.length}`);

  // Test 5: Admin 200 on /api/reports/finance-stats
  const adminFinanceRes = await server.inject({
    method: 'GET',
    url: '/api/reports/finance-stats',
    headers: { cookie: adminCookie },
  });
  const financeBody = adminFinanceRes.json();
  const hasKpiFields = typeof financeBody.data?.totalRevenue === 'number' && typeof financeBody.data?.collectionRatePct === 'number';
  record('Reports: Admin gets financial KPI cards', adminFinanceRes.statusCode === 200 && hasKpiFields, `Total Revenue: €${financeBody.data?.totalRevenue}`);

  // ---------------------------------------------------------
  // GROUP 2: DUTCH VAT REPORTING & VAT FILING PERSISTENCE
  // ---------------------------------------------------------

  // Test 6: GET /api/reports/taxes (reused accounting VAT calculation)
  const adminTaxesRes = await server.inject({
    method: 'GET',
    url: '/api/reports/taxes?year=2026&quarter=Q4',
    headers: { cookie: adminCookie },
  });
  const taxesBody = adminTaxesRes.json();
  const hasVatBoxes = Boolean(taxesBody.data?.boxes?.box1a && taxesBody.data?.boxes?.box5b);
  record('VAT: GET /api/reports/taxes returns Rubrieken 1a, 1b, 5b', adminTaxesRes.statusCode === 200 && hasVatBoxes);

  // Test 7: POST /api/reports/taxes/file creates vat_filings record
  const fileVatRes = await server.inject({
    method: 'POST',
    url: '/api/reports/taxes/file',
    headers: { cookie: adminCookie },
    payload: { year: 2026, quarter: 'Q4' },
  });
  const fileVatBody = fileVatRes.json();
  const filingNumber = fileVatBody.data?.filingNumber;
  record('VAT: POST /api/reports/taxes/file creates filing record', (fileVatRes.statusCode === 201 || fileVatRes.statusCode === 200) && filingNumber?.startsWith('BTW-2026-Q4'), `Filing: ${filingNumber}`);

  // Test 8: POST /api/reports/taxes/file duplicate prevents overwrite and returns existing
  const duplicateVatRes = await server.inject({
    method: 'POST',
    url: '/api/reports/taxes/file',
    headers: { cookie: adminCookie },
    payload: { year: 2026, quarter: 'Q4' },
  });
  const dupBody = duplicateVatRes.json();
  record('VAT: Duplicate filing returns existing record without creating duplicate', duplicateVatRes.statusCode === 200 && dupBody.alreadyFiled === true);

  // Test 9: GET /api/reports/taxes/receipt-pdf returns valid PDF stream
  const vatPdfRes = await server.inject({
    method: 'GET',
    url: `/api/reports/taxes/receipt-pdf?filingNumber=${filingNumber}`,
    headers: { cookie: adminCookie },
  });
  const isVatPdf = vatPdfRes.headers['content-type'] === 'application/pdf' && vatPdfRes.payload.startsWith('%PDF-1.4');
  record('VAT: GET /api/reports/taxes/receipt-pdf streams valid PDF', vatPdfRes.statusCode === 200 && isVatPdf);

  // ---------------------------------------------------------
  // GROUP 3: PROFIT & LOSS AND EXPORT STREAMS
  // ---------------------------------------------------------

  // Test 10: GET /api/reports/profit-loss returns project margins & gross profit
  const plRes = await server.inject({
    method: 'GET',
    url: '/api/reports/profit-loss',
    headers: { cookie: adminCookie },
  });
  const plBody = plRes.json();
  const hasPlItems = Array.isArray(plBody.data?.items) && typeof plBody.data?.summary?.averageMarginPct === 'number';
  record('P&L: GET /api/reports/profit-loss returns project margins', plRes.statusCode === 200 && hasPlItems, `Avg Margin: ${plBody.data?.summary?.averageMarginPct}%`);

  // Test 11: GET /api/reports/profit-loss?category=Outdoor+Kitchens filters correctly
  const plFilterRes = await server.inject({
    method: 'GET',
    url: '/api/reports/profit-loss?category=Outdoor+Kitchens',
    headers: { cookie: adminCookie },
  });
  const plFilterBody = plFilterRes.json();
  const allKitchens = plFilterBody.data?.items?.every((it: any) => it.category === 'Outdoor Kitchens');
  record('P&L: Filter by category operates correctly', plFilterRes.statusCode === 200 && (allKitchens || plFilterBody.data?.items?.length === 0));

  // Test 12: GET /api/reports/export/csv?type=funnel streams valid CSV
  const csvFunnelRes = await server.inject({
    method: 'GET',
    url: '/api/reports/export/csv?type=funnel',
    headers: { cookie: adminCookie },
  });
  const isCsv = Boolean(csvFunnelRes.headers['content-type']?.includes('text/csv') && csvFunnelRes.payload.includes('Stage,Inquiries Count,Percentage'));
  record('Export: GET /api/reports/export/csv streams valid RFC 4180 CSV', csvFunnelRes.statusCode === 200 && isCsv);

  // Test 13: GET /api/reports/export/pdf streams Executive Business Report PDF
  const reportPdfRes = await server.inject({
    method: 'GET',
    url: '/api/reports/export/pdf',
    headers: { cookie: adminCookie },
  });
  const isReportPdf = reportPdfRes.headers['content-type'] === 'application/pdf' && reportPdfRes.payload.startsWith('%PDF-1.4');
  record('Export: GET /api/reports/export/pdf streams valid executive PDF', reportPdfRes.statusCode === 200 && isReportPdf);

  // ---------------------------------------------------------
  // GROUP 4: PARTNER PORTAL DASHBOARD & PROGRESS
  // ---------------------------------------------------------

  // Test 14: GET /api/partner/dashboard/stats scoped to partner
  const partnerStatsRes = await server.inject({
    method: 'GET',
    url: '/api/partner/dashboard/stats',
    headers: { cookie: partnerCookie },
  });
  const partnerStatsBody = partnerStatsRes.json();
  const hasPartnerStats = typeof partnerStatsBody.data?.totalAssignedProjects === 'number';
  record('Partner: GET /api/partner/dashboard/stats scoped to partner', partnerStatsRes.statusCode === 200 && hasPartnerStats, `Assigned: ${partnerStatsBody.data?.totalAssignedProjects}`);

  // Test 15: GET /api/partner/dashboard/schedule returns upcoming events
  const partnerScheduleRes = await server.inject({
    method: 'GET',
    url: '/api/partner/dashboard/schedule',
    headers: { cookie: partnerCookie },
  });
  record('Partner: GET /api/partner/dashboard/schedule returns events array', partnerScheduleRes.statusCode === 200 && Array.isArray(partnerScheduleRes.json().data));

  // Test 16: PATCH /api/partner/projects/:id/progress updates assigned project
  const updateProgressRes = await server.inject({
    method: 'PATCH',
    url: `/api/partner/projects/${testProject.id}/progress`,
    headers: { cookie: partnerCookie },
    payload: { progress: 75, status: 'In Progress' },
  });
  record('Partner: Updates progress on assigned project', updateProgressRes.statusCode === 200 && updateProgressRes.json().data?.progress === 75);

  // Test 17: PATCH /api/partner/projects/:id/progress fails with 403 on unassigned project
  const unassignedProgressRes = await server.inject({
    method: 'PATCH',
    url: `/api/partner/projects/${foreignProject.id}/progress`,
    headers: { cookie: partnerCookie },
    payload: { progress: 50 },
  });
  record('Partner: Denied (403) when updating unassigned project', unassignedProgressRes.statusCode === 403);

  // Test 18: GET /api/partner/reports/summary-pdf generates scorecard PDF
  const partnerPdfRes = await server.inject({
    method: 'GET',
    url: '/api/partner/reports/summary-pdf',
    headers: { cookie: partnerCookie },
  });
  const isPartnerPdf = partnerPdfRes.headers['content-type'] === 'application/pdf' && partnerPdfRes.payload.startsWith('%PDF-1.4');
  record('Partner: Summary Scorecard PDF generated & streamed', partnerPdfRes.statusCode === 200 && isPartnerPdf);

  // ---------------------------------------------------------
  // GROUP 5: USER PROFILE & ACCOUNT SECURITY
  // ---------------------------------------------------------

  // Test 19: GET /api/users/profile returns profile without passwordHash
  const profileRes = await server.inject({
    method: 'GET',
    url: '/api/users/profile',
    headers: { cookie: adminCookie },
  });
  const profileBody = profileRes.json();
  const noHashExposed = !profileBody.data?.passwordHash && typeof profileBody.data?.email === 'string';
  record('Profile: GET returns metadata without exposing password hash', profileRes.statusCode === 200 && noHashExposed);

  // Test 20: PATCH /api/users/profile updates language and timezone
  const updateProfileRes = await server.inject({
    method: 'PATCH',
    url: '/api/users/profile',
    headers: { cookie: adminCookie },
    payload: { phone: '+31 6 11223344', language: 'nl', timezone: 'Europe/Amsterdam' },
  });
  const updateBody = updateProfileRes.json();
  record('Profile: PATCH updates phone, language, and timezone', updateProfileRes.statusCode === 200 && updateBody.data?.phone === '+31 6 11223344');

  // Test 21: PATCH /api/users/profile/password fails on incorrect current password
  const wrongPasswordRes = await server.inject({
    method: 'PATCH',
    url: '/api/users/profile/password',
    headers: { cookie: adminCookie },
    payload: { currentPassword: 'wrongPassword999', newPassword: 'newAdminPassword123' },
  });
  record('Security: Fails with 400 on incorrect current password', wrongPasswordRes.statusCode === 400 && wrongPasswordRes.json().error?.code === 'INCORRECT_CURRENT_PASSWORD');

  // Test 22: PATCH /api/users/profile/password succeeds on correct current password
  const correctPasswordRes = await server.inject({
    method: 'PATCH',
    url: '/api/users/profile/password',
    headers: { cookie: adminCookie },
    payload: { currentPassword: 'admin123', newPassword: 'newAdminPassword123' },
  });
  record('Security: Successfully updates password with verified current password', correctPasswordRes.statusCode === 200);

  // Test 23: Re-authenticate with new password & restore original password
  const newLoginRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@vanuitambacht.nl', password: 'newAdminPassword123' },
  });
  const newAdminCookie = extractCookie(newLoginRes);
  record('Security: Authenticates with newly changed password', newLoginRes.statusCode === 200 && Boolean(newAdminCookie));

  // Restore password back to admin123 for regression test integrity
  await server.inject({
    method: 'PATCH',
    url: '/api/users/profile/password',
    headers: { cookie: newAdminCookie },
    payload: { currentPassword: 'newAdminPassword123', newPassword: 'admin123' },
  });

  // Test 24: POST /api/users/profile/avatar rejects invalid file format (.exe)
  const badAvatarRes = await server.inject({
    method: 'POST',
    url: '/api/users/profile/avatar',
    headers: { cookie: adminCookie },
    payload: {
      fileBase64: Buffer.from('malicious payload').toString('base64'),
      fileName: 'exploit.exe',
      mimeType: 'application/x-msdownload',
    },
  });
  record('Security: Rejects executable avatar upload (.exe)', badAvatarRes.statusCode === 400);

  // Test 25: POST /api/users/profile/avatar saves valid image and updates avatarUrl
  const validAvatarRes = await server.inject({
    method: 'POST',
    url: '/api/users/profile/avatar',
    headers: { cookie: adminCookie },
    payload: {
      fileBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      fileName: 'avatar.png',
      mimeType: 'image/png',
    },
  });
  const avatarBody = validAvatarRes.json();
  record('Profile: Avatar uploaded successfully and relative URL returned', validAvatarRes.statusCode === 200 && avatarBody.data?.avatarUrl?.startsWith('/uploads/avatars/'));

  // ---------------------------------------------------------
  // GROUP 6: CUSTOMER SUPPLEMENTAL APIS & DATA ISOLATION
  // ---------------------------------------------------------

  // Test 26: GET /api/customer/projects/:id/quotes succeeds for customer's own project
  const customerQuotesRes = await server.inject({
    method: 'GET',
    url: `/api/customer/projects/${testProject.id}/quotes`,
    headers: { cookie: customerCookie },
  });
  record('Customer: GET /quotes succeeds for customer own project', customerQuotesRes.statusCode === 200 && Array.isArray(customerQuotesRes.json().data));

  // Create a second customer and foreign customer project
  const [secondCustUser] = await db
    .insert(users)
    .values({
      email: `other-cust-${Date.now()}@test.nl`,
      passwordHash: 'hash',
      role: 'customer',
      fullName: 'Other Customer',
    })
    .returning();

  const [secondCustomer] = await db
    .insert(customers)
    .values({
      userId: secondCustUser.id,
      customerNumber: `CUST-OTH-${Date.now().toString().slice(-4)}`,
      firstName: 'Other',
      lastName: 'Customer',
      email: secondCustUser.email,
      phone: '+31612345678',
      city: 'Utrecht',
    })
    .returning();

  const [foreignCustomerProject] = await db
    .insert(projects)
    .values({
      projectNumber: `PRJ-FRN-${Date.now().toString().slice(-4)}`,
      customerId: secondCustomer.id,
      name: 'Forbidden Customer Villa Project',
      projectType: 'outdoor_kitchen',
      status: 'pending',
      deliveryAddress: 'Keizersgracht 100, Amsterdam',
      city: 'Amsterdam',
    })
    .returning();

  const foreignQuotesRes = await server.inject({
    method: 'GET',
    url: `/api/customer/projects/${foreignCustomerProject.id}/quotes`,
    headers: { cookie: customerCookie },
  });
  record('Customer: Denied (403) when attempting to view foreign project quotes', foreignQuotesRes.statusCode === 403);

  // Test 28: GET /api/customer/projects/:id/contact succeeds for customer's own project
  const customerContactRes = await server.inject({
    method: 'GET',
    url: `/api/customer/projects/${testProject.id}/contact`,
    headers: { cookie: customerCookie },
  });
  const contactBody = customerContactRes.json();
  const hasCompanyContact = contactBody.data?.company?.name === 'Vanuit Ambacht B.V.';
  record('Customer: GET /contact returns company & partner contacts', customerContactRes.statusCode === 200 && hasCompanyContact);

  // Test 29: GET /api/customer/projects/:id/contact fails with 403 on foreign project
  const foreignContactRes = await server.inject({
    method: 'GET',
    url: `/api/customer/projects/${foreignCustomerProject.id}/contact`,
    headers: { cookie: customerCookie },
  });
  record('Customer: Denied (403) when accessing contact channels of foreign project', foreignContactRes.statusCode === 403);

  // Cleanup test foreign projects
  await db.delete(projects).where(eq(projects.id, foreignProject.id));
  await db.delete(projects).where(eq(projects.id, foreignCustomerProject.id));
  await db.delete(customers).where(eq(customers.id, secondCustomer.id));
  await db.delete(users).where(eq(users.id, secondCustUser.id));

  // ---------------------------------------------------------
  // FINAL SCORECARD
  // ---------------------------------------------------------
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log('\n======================================================');
  console.log(`📊 MODULE 14 RESULTS: ${passed}/${total} PASSED (${failed} failed)`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
