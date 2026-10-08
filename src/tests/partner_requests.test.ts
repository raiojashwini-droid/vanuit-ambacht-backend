/**
 * Comprehensive Automated Test Suite for Module 3: Partner Price Requests & Offers
 * 
 * Verifies:
 * - Authentication requirements (401)
 * - RBAC guards: Admin only vs Partner vs Customer (403)
 * - Inquiry creation with auto-numbering (PR-YYYY-XXX) & specifications
 * - Lead workflow progression to Step 2 & automatic commercial action logging
 * - Specs update before selection (PATCH /api/partner-requests/:id)
 * - Partner scoping & privacy isolation (no customer name/contact/budget leaks to partner)
 * - Partner offer submission with structured JSONB breakdown (POST /api/partner-requests/:id/offers)
 * - Auto-numbering (OFF-YYYY-XXX) and revision tracking (Rev 1 -> Rev 2 superseded)
 * - Lead workflow progression to Step 3 (price_received)
 * - Winning offer selection (PATCH /api/partner-requests/:id/select-offer) advancing lead to Step 4
 * - Partner declining inquiry (POST /api/partner-requests/:id/decline)
 * - Document download authorization checks (GET /api/documents/:id/download)
 */

import server from '../server.js';
import { db, sqlClient } from '../db/index.js';
import {
  partnerPriceRequests,
  partnerOffers,
  leads,
  partners,
  users,
  commercialActions,
  documents,
} from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
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

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING PARTNER PRICE REQUESTS & OFFERS (MODULE 3) TEST SUITE');
  console.log('======================================================\n');

  await server.ready();

  function extractCookie(res: any): string {
    const raw = res.headers['set-cookie'];
    if (!raw) return '';
    return Array.isArray(raw) ? raw[0] : (raw as string);
  }

  // ---------------------------------------------------------
  // 0. AUTHENTICATION & TEST ENTITIES SETUP
  // ---------------------------------------------------------
  // Admin Login
  const adminLoginRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@vanuitambacht.nl', password: 'admin123' },
  });
  const adminCookie = extractCookie(adminLoginRes);

  // Partner 1 Login (Sven Hoek)
  const partner1LoginRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'partner@vanuitambacht.nl', password: 'partner123' },
  });
  const partner1Cookie = extractCookie(partner1LoginRes);

  // Customer Login (Bjorn Valk)
  const customerLoginRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'customer@vanuitambacht.nl', password: 'customer123' },
  });
  const customerCookie = extractCookie(customerLoginRes);

  // Find partner 1 profile
  const [partner1] = await db
    .select()
    .from(partners)
    .where(eq(partners.email, 'partner@vanuitambacht.nl'))
    .limit(1);

  if (!partner1) {
    throw new Error('Partner 1 not found in seed database');
  }

  // Create or retrieve Partner 2 (for cross-partner isolation tests)
  const partner2Email = 'partner2_test@vanuitambacht.nl';
  let [partner2User] = await db
    .select()
    .from(users)
    .where(eq(users.email, partner2Email))
    .limit(1);

  if (!partner2User) {
    const passwordHash = await bcrypt.hash('partner123', 10);
    [partner2User] = await db
      .insert(users)
      .values({
        email: partner2Email,
        passwordHash,
        role: 'partner',
        fullName: 'Lars Meijer',
        isActive: true,
      })
      .returning();
  }

  let [partner2] = await db
    .select()
    .from(partners)
    .where(eq(partners.userId, partner2User.id))
    .limit(1);

  if (!partner2) {
    [partner2] = await db
      .insert(partners)
      .values({
        userId: partner2User.id,
        partnerCode: 'PRT-LARS-02',
        companyName: 'Meijer Hout & Staalbouw',
        contactPerson: 'Lars Meijer',
        email: partner2Email,
        phone: '+31 6 77778888',
        region: 'Noord-Holland',
        workloadStatus: 'available',
      })
      .returning();
  }

  const partner2LoginRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: partner2Email, password: 'partner123' },
  });
  const partner2Cookie = extractCookie(partner2LoginRes);

  // Create a clean test lead for the inquiry
  const [testAdmin] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
  const testLeadRes = await server.inject({
    method: 'POST',
    url: '/api/leads',
    headers: { cookie: adminCookie },
    payload: {
      name: 'Fam. Van Dijk Outdoor Dining',
      email: 'vandijk.test@gmail.com',
      phone: '+31 6 98765432',
      address: 'Keizersgracht 450',
      city: 'Amsterdam',
      productType: 'outdoor_kitchen',
      dimensionsInquiry: '380x110cm met BBQ eiland',
      initialNotes: 'Volledig uitgeruste luxe buitenkeuken met kamado aansluiting',
    },
  });
  const testLead = JSON.parse(testLeadRes.body).data;

  // ---------------------------------------------------------
  // 1. AUTHENTICATION & RBAC GUARDS
  // ---------------------------------------------------------
  console.log('--- 1. Testing Authentication & RBAC Guards ---');

  const unauthRes = await server.inject({
    method: 'GET',
    url: '/api/partner-requests',
  });
  record(
    'Unauthenticated request returns 401 Unauthorized',
    unauthRes.statusCode === 401,
    JSON.parse(unauthRes.body).error?.code
  );

  const customerRes = await server.inject({
    method: 'GET',
    url: '/api/partner-requests',
    headers: { cookie: customerCookie },
  });
  record(
    'Customer role blocked from partner-requests with 403 Forbidden',
    customerRes.statusCode === 403,
    JSON.parse(customerRes.body).error?.code
  );

  const partnerCreateBlockedRes = await server.inject({
    method: 'POST',
    url: '/api/partner-requests',
    headers: { cookie: partner1Cookie },
    payload: {
      leadId: testLead.id,
      partnerId: partner1.id,
      expectedResponseDate: '2026-11-01',
    },
  });
  record(
    'Partner role blocked from creating partner requests (403 Forbidden)',
    partnerCreateBlockedRes.statusCode === 403,
    JSON.parse(partnerCreateBlockedRes.body).error?.code
  );

  // ---------------------------------------------------------
  // 2. ADMIN CREATES PARTNER PRICE REQUEST
  // ---------------------------------------------------------
  console.log('\n--- 2. Testing Inquiry Creation (POST /api/partner-requests) ---');

  const createReqRes = await server.inject({
    method: 'POST',
    url: '/api/partner-requests',
    headers: { cookie: adminCookie },
    payload: {
      leadId: testLead.id,
      partnerId: partner1.id,
      category: 'Luxe Buitenkeuken',
      productInfo: 'Maatwerk buitenkeuken met keramisch werkblad en geïntegreerde Green Egg',
      dimensions: {
        lengthCm: 380,
        widthCm: 110,
        heightCm: 92,
        rawText: '380x110x92cm met overhangend zitgedeelte',
      },
      materials: {
        woodType: 'Massief Thermo Essen',
        countertop: 'Dekton Laurent 20mm',
        appliances: ['Green Egg Large', 'RVS Inbouwspoelbak', 'Quooker Flex'],
        notes: 'Verzonken ledverlichting onder het werkblad',
      },
      locationAccess: {
        city: 'Amsterdam',
        siteAccess: 'Achterom via brede steeg (min 120cm doorgang)',
        gardenAccessNotes: 'Begane grond, geen trappen of liften nodig',
      },
      expectedResponseDate: '2026-10-15',
    },
  });

  const createdReq = JSON.parse(createReqRes.body).data;
  record(
    'Admin creates partner price request inquiry (201 Created)',
    createReqRes.statusCode === 201 && createdReq.requestNumber.startsWith('PR-2026-'),
    `Request Number: ${createdReq?.requestNumber}, Status: ${createdReq?.status}`
  );

  // Verify Lead workflow step advanced to Step 2
  const [updatedLeadAfterCreate] = await db
    .select({ workflowStep: leads.workflowStep, status: leads.status })
    .from(leads)
    .where(eq(leads.id, testLead.id));
  record(
    'Lead workflow step automatically updated to Step 2 (in_conversation)',
    updatedLeadAfterCreate.workflowStep === 2 && updatedLeadAfterCreate.status === 'in_conversation',
    `Step: ${updatedLeadAfterCreate.workflowStep}, Status: ${updatedLeadAfterCreate.status}`
  );

  // Verify commercial action logged
  const [commAction] = await db
    .select()
    .from(commercialActions)
    .where(and(eq(commercialActions.leadId, testLead.id), eq(commercialActions.actionType, 'partner_request_created')))
    .limit(1);
  record(
    'Commercial action automatically logged on lead timeline',
    Boolean(commAction),
    commAction?.note
  );

  // ---------------------------------------------------------
  // 3. ADMIN UPDATES SPECIFICATIONS
  // ---------------------------------------------------------
  console.log('\n--- 3. Testing Inquiry Updates (PATCH /api/partner-requests/:id) ---');

  const updateReqRes = await server.inject({
    method: 'PATCH',
    url: `/api/partner-requests/${createdReq.id}`,
    headers: { cookie: adminCookie },
    payload: {
      category: 'Luxe Buitenkeuken & Bar',
      dimensions: {
        lengthCm: 400,
        widthCm: 110,
        heightCm: 92,
        rawText: 'Vergroot naar 400cm',
      },
    },
  });

  const updatedReq = JSON.parse(updateReqRes.body).data;
  record(
    'Admin updates request specifications (200 OK)',
    updateReqRes.statusCode === 200 && updatedReq.dimensions.lengthCm === 400,
    `Updated Category: ${updatedReq.category}, Length: ${updatedReq.dimensions.lengthCm}cm`
  );

  // ---------------------------------------------------------
  // 4. PARTNER SCOPING & PRIVACY ISOLATION
  // ---------------------------------------------------------
  console.log('\n--- 4. Testing Partner Scoping & Privacy Isolation ---');

  // Partner 1 gets dossier
  const partner1DossierRes = await server.inject({
    method: 'GET',
    url: `/api/partner-requests/${createdReq.id}`,
    headers: { cookie: partner1Cookie },
  });
  const partner1Dossier = JSON.parse(partner1DossierRes.body).data;

  record(
    'Assigned partner can view request dossier (200 OK)',
    partner1DossierRes.statusCode === 200 && partner1Dossier.id === createdReq.id,
    `Partner Request: ${partner1Dossier.requestNumber}`
  );

  // Strict Privacy Check: Partner MUST NOT see client personal info or profit margins
  const hasNoCustomerLeaked =
    partner1Dossier.customerName === undefined &&
    partner1Dossier.customerEmail === undefined &&
    partner1Dossier.customerPhone === undefined &&
    partner1Dossier.customerAddress === undefined &&
    partner1Dossier.customerBudget === undefined &&
    partner1Dossier.targetMarginPercent === undefined;

  record(
    'Strict Privacy: Customer personal info & profit margin strictly hidden from Partner',
    hasNoCustomerLeaked,
    'No client email, phone, address, or margin leaked'
  );

  // Admin gets dossier -> Admin DOES see customer details & margins
  const adminDossierRes = await server.inject({
    method: 'GET',
    url: `/api/partner-requests/${createdReq.id}`,
    headers: { cookie: adminCookie },
  });
  const adminDossier = JSON.parse(adminDossierRes.body).data;
  record(
    'Admin dossier retains full customer contact & financial metrics',
    adminDossier.customerName !== undefined && adminDossier.customerEmail === 'vandijk.test@gmail.com',
    `Customer: ${adminDossier.customerName}, Email: ${adminDossier.customerEmail}`
  );

  // Cross-Partner Isolation: Partner 2 cannot access Partner 1's request
  const partner2ForbiddenRes = await server.inject({
    method: 'GET',
    url: `/api/partner-requests/${createdReq.id}`,
    headers: { cookie: partner2Cookie },
  });
  record(
    'Unassigned partner blocked from viewing inquiry with 403 Forbidden',
    partner2ForbiddenRes.statusCode === 403,
    JSON.parse(partner2ForbiddenRes.body).error?.message
  );

  // Partner 1 list view filters to assigned only
  const partner1ListRes = await server.inject({
    method: 'GET',
    url: '/api/partner-requests',
    headers: { cookie: partner1Cookie },
  });
  const partner1List = JSON.parse(partner1ListRes.body).data;
  const onlyAssigned = partner1List.items.every((it: any) => it.partnerId === partner1.id);
  record(
    'Partner inquiry list strictly scoped to assigned partner profile',
    onlyAssigned && partner1List.items.length >= 1,
    `Items count: ${partner1List.items.length}`
  );

  // ---------------------------------------------------------
  // 5. PARTNER SUBMITS BID WITH STRUCTURED BREAKDOWN
  // ---------------------------------------------------------
  console.log('\n--- 5. Testing Offer Submission & Structured Breakdown ---');

  const offerPayload = {
    costPrice: 4250.0,
    materialsCost: 2400.0,
    laborCost: 1400.0,
    laborHours: 28,
    estimatedLeadTimeWeeks: 4,
    partnerNotes: 'Inclusief transport en professionele plaatsing op locatie in Amsterdam.',
    breakdown: {
      transportCost: 150.0,
      installationCost: 300.0,
      otherCost: 0,
      items: [
        {
          sectionTitle: 'Maatwerk Constructie',
          label: 'Massief Thermo Essen frame met pen-en-gat verbindingen',
          amount: 1800.0,
        },
        {
          sectionTitle: 'Blad & Afwerking',
          label: 'Dekton Laurent 20mm met uitsparingen',
          amount: 1200.0,
        },
        {
          sectionTitle: 'Hang- en Sluitwerk',
          label: 'Blum soft-close ladegeleiders en RVS scharnieren',
          amount: 800.0,
        },
      ],
    },
  };

  const submitOfferRes = await server.inject({
    method: 'POST',
    url: `/api/partner-requests/${createdReq.id}/offers`,
    headers: { cookie: partner1Cookie },
    payload: offerPayload,
  });

  const offerV1 = JSON.parse(submitOfferRes.body).data;
  record(
    'Partner submits offer with structured breakdown (201 Created)',
    submitOfferRes.statusCode === 201 && offerV1.offerNumber.startsWith('OFF-2026-') && offerV1.revisionNumber === 1,
    `Offer Number: ${offerV1?.offerNumber}, Cost: €${offerV1?.costPrice}`
  );

  record(
    'Breakdown JSONB correctly validated and persisted to database',
    offerV1.breakdown?.items?.length === 3 && offerV1.breakdown.transportCost === 150.0,
    `Breakdown items: ${offerV1.breakdown?.items?.length}, Transport: €${offerV1.breakdown?.transportCost}`
  );

  // Check that request status updated to 'offers_received'
  const [reqAfterOffer] = await db
    .select({ status: partnerPriceRequests.status })
    .from(partnerPriceRequests)
    .where(eq(partnerPriceRequests.id, createdReq.id));
  record(
    'Partner price request status updated to offers_received',
    reqAfterOffer.status === 'offers_received',
    `Status: ${reqAfterOffer.status}`
  );

  // Check that lead workflow step advanced to Step 3 (Partner price received)
  const [leadAfterOffer] = await db
    .select({ workflowStep: leads.workflowStep, status: leads.status })
    .from(leads)
    .where(eq(leads.id, testLead.id));
  record(
    'Lead workflow advanced to Step 3 (price_received)',
    leadAfterOffer.workflowStep === 3 && leadAfterOffer.status === 'price_received',
    `Step: ${leadAfterOffer.workflowStep}, Status: ${leadAfterOffer.status}`
  );

  // ---------------------------------------------------------
  // 6. REVISION TRACKING & SUPERSEDING
  // ---------------------------------------------------------
  console.log('\n--- 6. Testing Offer Revision Tracking (v1 -> v2 Superseded) ---');

  const revisedOfferPayload = {
    ...offerPayload,
    costPrice: 4100.0,
    materialsCost: 2300.0,
    partnerNotes: 'Herziene offerte: korting toegepast op materialen.',
  };

  const submitRev2Res = await server.inject({
    method: 'POST',
    url: `/api/partner-requests/${createdReq.id}/offers`,
    headers: { cookie: partner1Cookie },
    payload: revisedOfferPayload,
  });

  const offerV2 = JSON.parse(submitRev2Res.body).data;
  record(
    'Partner submits Revision 2 offer (201 Created)',
    submitRev2Res.statusCode === 201 && offerV2.revisionNumber === 2,
    `Offer: ${offerV2.offerNumber} (Rev ${offerV2.revisionNumber}), Cost: €${offerV2.costPrice}`
  );

  // Verify previous offer (v1) was marked superseded
  const [dbOfferV1] = await db
    .select({ status: partnerOffers.status })
    .from(partnerOffers)
    .where(eq(partnerOffers.id, offerV1.id));
  record(
    'Previous revision (v1) automatically marked as superseded',
    dbOfferV1.status === 'superseded',
    `V1 Status: ${dbOfferV1.status}`
  );

  // GET offers endpoint lists revisions
  const getOffersRes = await server.inject({
    method: 'GET',
    url: `/api/partner-requests/${createdReq.id}/offers`,
    headers: { cookie: partner1Cookie },
  });
  const offersList = JSON.parse(getOffersRes.body).data;
  record(
    'GET /api/partner-requests/:id/offers returns complete revision history',
    offersList.length === 2 && offersList[0].revisionNumber === 2 && offersList[1].revisionNumber === 1,
    `Total Revisions: ${offersList.length}`
  );

  // ---------------------------------------------------------
  // 7. ADMIN SELECTS WINNING OFFER
  // ---------------------------------------------------------
  console.log('\n--- 7. Testing Offer Selection (PATCH /api/partner-requests/:id/select-offer) ---');

  const selectOfferRes = await server.inject({
    method: 'PATCH',
    url: `/api/partner-requests/${createdReq.id}/select-offer`,
    headers: { cookie: adminCookie },
    payload: {
      offerId: offerV2.id,
      note: 'Akkoord met herziene prijsopgave. Start calculatie en klantofferte.',
    },
  });

  const selectResult = JSON.parse(selectOfferRes.body).data;
  record(
    'Admin selects winning offer (200 OK)',
    selectOfferRes.statusCode === 200 && selectResult.selectedOffer.status === 'accepted',
    `Winning Offer: ${selectResult.selectedOffer.offerNumber} (Status: ${selectResult.selectedOffer.status})`
  );

  record(
    'Partner price request marked as selected',
    selectResult.request.status === 'selected',
    `Request Status: ${selectResult.request.status}`
  );

  // Verify Lead workflow step advanced to Step 4 (Build the quote)
  const [leadAfterSelect] = await db
    .select({ workflowStep: leads.workflowStep, status: leads.status })
    .from(leads)
    .where(eq(leads.id, testLead.id));
  record(
    'Lead workflow advanced to Step 4 (Build the quote / quote_sent)',
    leadAfterSelect.workflowStep === 4,
    `Step: ${leadAfterSelect.workflowStep}`
  );

  // ---------------------------------------------------------
  // 8. PARTNER DECLINING INQUIRY
  // ---------------------------------------------------------
  console.log('\n--- 8. Testing Inquiry Decline (POST /api/partner-requests/:id/decline) ---');

  // Create a second request to test decline
  const req2Res = await server.inject({
    method: 'POST',
    url: '/api/partner-requests',
    headers: { cookie: adminCookie },
    payload: {
      leadId: testLead.id,
      partnerId: partner1.id,
      category: 'Tuinkamer Overkapping',
      expectedResponseDate: '2026-10-20',
    },
  });
  const req2 = JSON.parse(req2Res.body).data;

  // Partner declines
  const declineRes = await server.inject({
    method: 'POST',
    url: `/api/partner-requests/${req2.id}/decline`,
    headers: { cookie: partner1Cookie },
    payload: {
      reason: 'Werkplaats is momenteel volledig volgeboekt voor de komende 6 weken.',
    },
  });
  const declinedReq = JSON.parse(declineRes.body).data;
  record(
    'Partner declines inquiry with reason (200 OK)',
    declineRes.statusCode === 200 && declinedReq.status === 'declined',
    `Status: ${declinedReq.status}`
  );

  // ---------------------------------------------------------
  // 9. SECURE DOCUMENT DOWNLOAD AUTHORIZATION
  // ---------------------------------------------------------
  console.log('\n--- 9. Testing Secure Document Download (GET /api/documents/:id/download) ---');

  // Create a tender attachment document in the documents table
  const [tenderDoc] = await db
    .insert(documents)
    .values({
      documentNumber: `DOC-2026-TEST-${Date.now().toString().slice(-4)}`,
      documentType: 'cad_blueprint',
      fileName: 'bouwtekening_buitenkeuken_v1.pdf',
      fileUrl: '/simulated/uploads/bouwtekening_buitenkeuken_v1.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1048576,
      leadId: testLead.id,
      isPublicForPartner: true,
      uploadedByUserId: testAdmin.id,
    })
    .returning();

  // Admin download succeeds
  const adminDocRes = await server.inject({
    method: 'GET',
    url: `/api/documents/${tenderDoc.id}/download`,
    headers: { cookie: adminCookie },
  });
  record(
    'Admin can download document attachment (200 OK)',
    adminDocRes.statusCode === 200 && adminDocRes.headers['content-type'] === 'application/pdf',
    `Content-Disposition: ${adminDocRes.headers['content-disposition']}`
  );

  // Assigned Partner (Partner 1) download succeeds
  const partner1DocRes = await server.inject({
    method: 'GET',
    url: `/api/documents/${tenderDoc.id}/download`,
    headers: { cookie: partner1Cookie },
  });
  record(
    'Assigned partner can download tender attachment (200 OK)',
    partner1DocRes.statusCode === 200,
    `Attachment downloaded for assigned lead`
  );

  // Unassigned Partner (Partner 2) download is forbidden (403)
  const partner2DocRes = await server.inject({
    method: 'GET',
    url: `/api/documents/${tenderDoc.id}/download`,
    headers: { cookie: partner2Cookie },
  });
  record(
    'Unassigned partner blocked from downloading attachment (403 Forbidden)',
    partner2DocRes.statusCode === 403,
    JSON.parse(partner2DocRes.body).error?.code
  );

  // Non-existent document returns 404
  const notFoundDocRes = await server.inject({
    method: 'GET',
    url: '/api/documents/00000000-0000-0000-0000-000000000000/download',
    headers: { cookie: adminCookie },
  });
  record(
    'Non-existent document returns 404 Not Found',
    notFoundDocRes.statusCode === 404,
    JSON.parse(notFoundDocRes.body).error?.code
  );

  // ---------------------------------------------------------
  // CLEANUP
  // ---------------------------------------------------------
  try {
    await db.delete(documents).where(eq(documents.id, tenderDoc.id));
    await db.delete(partnerOffers).where(eq(partnerOffers.requestId, createdReq.id));
    await db.delete(partnerPriceRequests).where(eq(partnerPriceRequests.id, createdReq.id));
    await db.delete(partnerPriceRequests).where(eq(partnerPriceRequests.id, req2.id));
    await db.delete(commercialActions).where(eq(commercialActions.leadId, testLead.id));
    await db.delete(leads).where(eq(leads.id, testLead.id));
  } catch (cleanErr) {
    console.warn('Cleanup warning:', cleanErr);
  }

  // ---------------------------------------------------------
  // TEST SUMMARY
  // ---------------------------------------------------------
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log('\n======================================================');
  console.log(`🏁 TEST RUN FINISHED: ${passed}/${total} TESTS PASSED`);
  if (failed > 0) {
    console.log(`❌ ${failed} TESTS FAILED`);
  }
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
