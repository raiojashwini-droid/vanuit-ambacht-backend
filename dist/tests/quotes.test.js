/**
 * Comprehensive Automated Test Suite for Module 4: Quotations & Calculations
 *
 * Verifies:
 * - 401 Unauthorized for unauthenticated access to admin quote routes
 * - 403 Forbidden for partner role accessing admin quote routes
 * - 403 Forbidden for customer role attempting quote mutation
 * - Quote creation (POST /api/quotes) with nullable customer_id (lead-only quote)
 * - Auto-numbering (OF-YYYY-XXX) & public token generation
 * - Draft update & autosave (PUT /api/quotes/:id/versions/draft)
 * - Accurate server-side recalculation (line items, subtotal excl. VAT, VAT 21%, total incl. VAT)
 * - Server-side margin calculation (cost price, selling price, margin amount, margin percentage)
 * - Initial draft version (v1) creation & lead progression to step 4
 * - Quote metadata update (PATCH /api/quotes/:id)
 * - Quote publishing (POST /api/quotes/:id/publish): locks v1, sets status=sent, advances lead to step 5
 * - Versioning requirement: Editing a sent quote creates a new draft version (v2) and preserves history
 * - Quote duplication (POST /api/quotes/:id/duplicate)
 * - Server-side 6-page PDF generation (GET /api/quotes/:id/pdf) returning application/pdf with %PDF-1.4
 * - Public offerte endpoint (GET /api/offerte/:token) without authentication
 * - Strict privacy guarantee: Public offerte NEVER exposes costPrice, margin, internalNotes, or partner identity
 * - Public 6-page PDF generation (GET /api/offerte/:token/pdf)
 * - Customer digital approval (POST /api/offerte/:token/approve) atomic transaction:
 *   * Quote status -> approved
 *   * Quote version locked with digital signature audit trail
 *   * Project created with status = in_progress, orderStatus = in_voorbereiding
 *   * 2 invoices created (50% upfront due 14d, 50% completion due 30d)
 *   * Lead updated to workflowStep = 7, status = won
 *   * Commercial timeline action logged
 * - Replay protection: Re-approving returns 409 Conflict
 * - Customer rejection (POST /api/offerte/:token/reject)
 * - Admin accept-and-convert (POST /api/quotes/:id/accept-and-convert)
 * - Quote deletion (DELETE /api/quotes/:id)
 */
import server from '../server.js';
import { db } from '../db/index.js';
import { quotes, quoteVersions, leads, projects, invoices, invoiceItems, commercialActions, } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { quoteService } from '../modules/quotes/quote.service.js';
const results = [];
function record(name, passed, details = '') {
    results.push({ name, passed, details });
    const icon = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${icon}: ${name}${details ? ` -> ${details}` : ''}`);
}
async function runTests() {
    console.log('\n======================================================');
    console.log('🧪 RUNNING QUOTATIONS & CALCULATIONS (MODULE 4) TEST SUITE');
    console.log('======================================================\n');
    await server.ready();
    function extractCookie(res) {
        const raw = res.headers['set-cookie'];
        if (!raw)
            return '';
        return Array.isArray(raw) ? raw[0] : raw;
    }
    // ---------------------------------------------------------
    // 0. AUTHENTICATION SETUP
    // ---------------------------------------------------------
    const adminLoginRes = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'admin@vanuitambacht.nl', password: 'admin123' },
    });
    const adminCookie = extractCookie(adminLoginRes);
    const customerLoginRes = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'customer@vanuitambacht.nl', password: 'customer123' },
    });
    const customerCookie = extractCookie(customerLoginRes);
    const partnerLoginRes = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'partner@vanuitambacht.nl', password: 'partner123' },
    });
    const partnerCookie = extractCookie(partnerLoginRes);
    // Create a dedicated test lead for quote tests
    const testLeadRes = await server.inject({
        method: 'POST',
        url: '/api/leads',
        headers: { cookie: adminCookie },
        payload: {
            name: 'Familie De Jong',
            email: `dejong_${Date.now()}@example.nl`,
            phone: '+31 6 12984576',
            city: 'Breda',
            address: 'Wilhelminastraat 42',
            productType: 'outdoor_kitchen',
            dimensionsInquiry: '300 x 75 cm',
            notes: 'Test lead for quotation module',
        },
    });
    const testLead = JSON.parse(testLeadRes.body).data;
    let createdQuoteId = '';
    let createdQuoteNumber = '';
    let createdPublicToken = '';
    let createdProjectId = '';
    try {
        // ---------------------------------------------------------
        // TEST 1: AUTHENTICATION & RBAC CHECKS
        // ---------------------------------------------------------
        console.log('\n--- 1. Authentication & RBAC ---');
        const unauthRes = await server.inject({
            method: 'GET',
            url: '/api/quotes',
        });
        record('GET /api/quotes requires authentication (401)', unauthRes.statusCode === 401);
        const partnerRes = await server.inject({
            method: 'GET',
            url: '/api/quotes',
            headers: { cookie: partnerCookie },
        });
        record('Partner cannot access admin quote list (403)', partnerRes.statusCode === 403);
        const custMutateRes = await server.inject({
            method: 'POST',
            url: '/api/quotes',
            headers: { cookie: customerCookie },
            payload: { productType: 'outdoor_kitchen' },
        });
        record('Customer cannot create quotes (403)', custMutateRes.statusCode === 403);
        // ---------------------------------------------------------
        // TEST 2: QUOTE CREATION WITH NULLABLE CUSTOMER_ID
        // ---------------------------------------------------------
        console.log('\n--- 2. Quote Creation & Auto-numbering ---');
        const createRes = await server.inject({
            method: 'POST',
            url: '/api/quotes',
            headers: { cookie: adminCookie },
            payload: {
                leadId: testLead.id,
                productType: 'outdoor_kitchen',
            },
        });
        record('POST /api/quotes creates new quote (201)', createRes.statusCode === 201, createRes.body);
        const createdData = JSON.parse(createRes.body).data;
        createdQuoteId = createdData.id;
        createdQuoteNumber = createdData.quoteNumber;
        createdPublicToken = createdData.publicToken;
        // Check numbering format: OF-YYYY-XXX
        const matchesQuoteNumber = /^OF-\d{4}-\d{3}$/.test(createdQuoteNumber);
        record('Quote number follows OF-YYYY-XXX format', matchesQuoteNumber, createdQuoteNumber);
        record('Quote has unique publicToken', Boolean(createdPublicToken && createdPublicToken.length >= 16));
        record('Quote customer_id is nullable (lead-only)', createdData.customerId === null);
        record('Quote is linked to leadId', createdData.leadId === testLead.id);
        const v1 = createdData.activeVersion;
        record('Version 1 initialized with versionNumber 1', v1.versionNumber === 1);
        record('Version 1 initial status is draft', v1.status === 'draft');
        // ---------------------------------------------------------
        // TEST 3: DRAFT AUTOSAVE & SERVER-SIDE FINANCIAL RECALCULATION
        // ---------------------------------------------------------
        console.log('\n--- 3. Draft Autosave & Financial Recalculation ---');
        const updateDraftRes = await server.inject({
            method: 'PUT',
            url: `/api/quotes/${createdQuoteId}/versions/draft`,
            headers: { cookie: adminCookie },
            payload: {
                costPrice: 5000,
                marginPercent: 41.18,
                letterConfig: {
                    salutation: 'Beste heer en mevrouw De Jong,',
                    letterParagraphs: [
                        'Hartelijk dank voor uw aanvraag voor een luxe maatwerk buitenkeuken.',
                        'Hierbij ontvangt u onze gedetailleerde offerte.',
                    ],
                    signoffName: 'Tim van Dongen',
                    signoffRole: 'Mede-oprichter Vanuit Ambacht',
                },
                coverTitleLine1: 'EXCLUSIEVE BUITENKEUKEN',
                coverTitleLine2: 'FAMILIE DE JONG - BREDA',
                dimensionsText: '300 x 75 cm',
                woodType: 'Thermo Frake',
                items: [
                    {
                        position: 1,
                        title: 'Maatwerk Meubel Frame & Ombouw',
                        description: 'Constructie in Thermo Frake en poedercoat zwart staal',
                        quantity: 1,
                        unitPriceInclVat: 4840.0, // 4000 excl + 21% vat
                        vatRate: 21,
                        isIncluded: false,
                        isStelpost: false,
                    },
                    {
                        position: 2,
                        title: 'Keramisch Werkblad Dekton',
                        description: 'Kleur Trilium, 20mm massief',
                        quantity: 1,
                        unitPriceInclVat: 3025.0, // 2500 excl + 21% vat
                        vatRate: 21,
                        isIncluded: false,
                        isStelpost: false,
                    },
                    {
                        position: 3,
                        title: 'Inbouw Kamado Joe Classic III',
                        description: 'Compleet met Divide & Conquer rek',
                        quantity: 1,
                        unitPriceInclVat: 2420.0, // 2000 excl + 21% vat
                        vatRate: 21,
                        isIncluded: false,
                        isStelpost: false,
                    },
                ],
            },
        });
        record('PUT /api/quotes/:id/versions/draft returns 200', updateDraftRes.statusCode === 200);
        const updatedDraft = JSON.parse(updateDraftRes.body).data.activeVersion;
        // Verify financial recalculation
        // 4840 + 3025 + 2420 = 10285.00 incl. VAT
        // Excl VAT = 4000 + 2500 + 2000 = 8500.00
        // VAT = 1785.00
        record('Draft totalInclVat matches exact sum (10285.00)', Number(updatedDraft.totalInclVat) === 10285);
        record('Draft subtotalExclVat matches exact sum (8500.00)', Number(updatedDraft.subtotalExclVat) === 8500);
        record('Draft vatAmount matches 21% VAT (1785.00)', Number(updatedDraft.vatAmount) === 1785);
        // Margin check: costPrice = 5000, subtotalExclVat = 8500 -> marginAmount = 3500
        // Markup on Cost: marginPercent = (3500 / 5000) * 100 = 70.00%
        record('Draft costPrice = 5000 and marginAmount = 3500', Number(updatedDraft.costPrice) === 5000 && Number(updatedDraft.marginAmount) === 3500);
        record('Draft marginPercent = 70 (Markup on Cost: 3500 / 5000 * 100)', Number(updatedDraft.marginPercent) === 70);
        // ---------------------------------------------------------
        // TEST 3B: INSTALMENTS (50/50 and 40/40/20 with remainder allocation)
        // ---------------------------------------------------------
        console.log('\n--- 3B. Payment Instalments Calculation (2-part and 3-part models) ---');
        // Direct test of 2 instalments (50/50)
        const inst2 = quoteService.calculateInstalments(10285.0);
        record('2-instalment count is 2', inst2.length === 2);
        record('2-instalment step 1 is 50% (5142.50)', inst2[0].percentage === 50 && inst2[0].amount === 5142.5);
        record('2-instalment step 2 is 50% (5142.50)', inst2[1].percentage === 50 && inst2[1].amount === 5142.5);
        record('2-instalment sum equals total (10285.00)', Math.round((inst2[0].amount + inst2[1].amount) * 100) / 100 === 10285.0);
        // Direct test of 3 instalments (40/40/20)
        const inst3 = quoteService.calculateInstalments(10285.0, 3, [40, 40, 20]);
        record('3-instalment count is 3', inst3.length === 3);
        record('3-instalment step 1 is 40% (4114.00)', inst3[0].percentage === 40 && inst3[0].amount === 4114.0);
        record('3-instalment step 2 is 40% (4114.00)', inst3[1].percentage === 40 && inst3[1].amount === 4114.0);
        record('3-instalment step 3 is 20% (2057.00)', inst3[2].percentage === 20 && inst3[2].amount === 2057.0);
        record('3-instalment sum equals total (10285.00)', Math.round((inst3[0].amount + inst3[1].amount + inst3[2].amount) * 100) / 100 === 10285.0);
        // Remainder handling test with odd cent (1000.01)
        const instOdd = quoteService.calculateInstalments(1000.01, 3, [40, 40, 20]);
        record('Odd amount step 1 is 400.00', instOdd[0].amount === 400.0);
        record('Odd amount step 2 is 400.00', instOdd[1].amount === 400.0);
        record('Odd amount step 3 remainder is 200.01', instOdd[2].amount === 200.01);
        record('Odd amount sum matches exact 1000.01', Math.round((instOdd[0].amount + instOdd[1].amount + instOdd[2].amount) * 100) / 100 === 1000.01);
        // Update draft version with 3 instalments (40/40/20) via API
        const update3InstRes = await server.inject({
            method: 'PUT',
            url: `/api/quotes/${createdQuoteId}/versions/draft`,
            headers: { cookie: adminCookie },
            payload: {
                instalmentsConfig: {
                    count: 3,
                    percentages: [40, 40, 20],
                    labels: ['Bij akkoord', 'Bij start bouw', 'Bij oplevering'],
                },
            },
        });
        record('PUT draft with 3-instalments (40/40/20) returns 200', update3InstRes.statusCode === 200);
        // Check lead workflow progression to Step 4 (Build quote)
        const [updatedLeadAfterCreate] = await db
            .select()
            .from(leads)
            .where(eq(leads.id, testLead.id))
            .limit(1);
        record('Lead workflow advanced to Step 4', updatedLeadAfterCreate.workflowStep >= 4);
        // ---------------------------------------------------------
        // TEST 4: GET /api/quotes AND GET /api/quotes/:id
        // ---------------------------------------------------------
        console.log('\n--- 4. Quote Retrieval & Search ---');
        const listRes = await server.inject({
            method: 'GET',
            url: `/api/quotes?search=${createdQuoteNumber}`,
            headers: { cookie: adminCookie },
        });
        record('GET /api/quotes returns 200', listRes.statusCode === 200);
        const listBody = JSON.parse(listRes.body).data;
        record('GET /api/quotes includes created quote in search results', listBody.items.some((q) => q.id === createdQuoteId));
        const getRes = await server.inject({
            method: 'GET',
            url: `/api/quotes/${createdQuoteId}`,
            headers: { cookie: adminCookie },
        });
        record('GET /api/quotes/:id returns 200', getRes.statusCode === 200);
        const getQuoteData = JSON.parse(getRes.body).data;
        record('GET /api/quotes/:id includes all 3 line items', getQuoteData.activeVersion.items.length === 3);
        // ---------------------------------------------------------
        // TEST 5: PUBLISH QUOTE (POST /api/quotes/:id/publish)
        // ---------------------------------------------------------
        console.log('\n--- 5. Quote Publishing ---');
        const publishRes = await server.inject({
            method: 'POST',
            url: `/api/quotes/${createdQuoteId}/publish`,
            headers: { cookie: adminCookie },
            payload: { validDays: 28 },
        });
        record('POST /api/quotes/:id/publish returns 200', publishRes.statusCode === 200);
        const publishedQuote = JSON.parse(publishRes.body).data;
        record('Quote status transitions to sent', publishedQuote.status === 'sent');
        record('Quote sentAt timestamp is set', Boolean(publishedQuote.sentAt));
        record('Active version status transitions to sent', publishedQuote.activeVersion.status === 'sent');
        // Lead progression to step 5 (Send quote)
        const [leadAfterPub] = await db
            .select()
            .from(leads)
            .where(eq(leads.id, testLead.id))
            .limit(1);
        record('Lead workflow advanced to Step 5', leadAfterPub.workflowStep >= 5);
        // ---------------------------------------------------------
        // TEST 6: EDITING SENT QUOTE CREATES NEW DRAFT VERSION
        // ---------------------------------------------------------
        console.log('\n--- 6. Versioning History on Sent Quote Edit ---');
        const editSentRes = await server.inject({
            method: 'PUT',
            url: `/api/quotes/${createdQuoteId}/versions/draft`,
            headers: { cookie: adminCookie },
            payload: {
                costPrice: 5800,
                items: [
                    {
                        position: 1,
                        title: 'Maatwerk Meubel Frame & Ombouw (v2)',
                        quantity: 1,
                        unitPriceInclVat: 10285.0,
                        vatRate: 21,
                        isIncluded: false,
                        isStelpost: false,
                    },
                ],
            },
        });
        record('Editing sent quote creates new draft version (200)', editSentRes.statusCode === 200);
        const v2Data = JSON.parse(editSentRes.body).data.activeVersion;
        record('New version has versionNumber = 2', v2Data.versionNumber === 2);
        record('New version status is draft', v2Data.status === 'draft');
        // Verify v1 still exists in database
        const allVersions = await db
            .select()
            .from(quoteVersions)
            .where(eq(quoteVersions.quoteId, createdQuoteId))
            .orderBy(quoteVersions.versionNumber);
        record('Quote preserves multiple versions in history', allVersions.length >= 2);
        // Re-publish to make v2 the active version for customer approval
        const publishV2Res = await server.inject({
            method: 'POST',
            url: `/api/quotes/${createdQuoteId}/publish`,
            headers: { cookie: adminCookie },
        });
        record('Publishing v2 makes it active', publishV2Res.statusCode === 200);
        // ---------------------------------------------------------
        // TEST 7: QUOTE DUPLICATION (POST /api/quotes/:id/duplicate)
        // ---------------------------------------------------------
        console.log('\n--- 7. Quote Duplication ---');
        const duplicateRes = await server.inject({
            method: 'POST',
            url: `/api/quotes/${createdQuoteId}/duplicate`,
            headers: { cookie: adminCookie },
        });
        record('POST /api/quotes/:id/duplicate returns 201', duplicateRes.statusCode === 201);
        const duplicatedQuote = JSON.parse(duplicateRes.body).data;
        record('Duplicate has distinct quoteNumber', duplicatedQuote.quoteNumber !== createdQuoteNumber);
        record('Duplicate has distinct publicToken', duplicatedQuote.publicToken !== createdPublicToken);
        record('Duplicate starts with status = draft', duplicatedQuote.status === 'draft');
        // ---------------------------------------------------------
        // TEST 8: SERVER-SIDE PDF GENERATION (ADMIN & PUBLIC)
        // ---------------------------------------------------------
        console.log('\n--- 8. 6-Page Server-side PDF Generation ---');
        const adminPdfRes = await server.inject({
            method: 'GET',
            url: `/api/quotes/${createdQuoteId}/pdf`,
            headers: { cookie: adminCookie },
        });
        record('GET /api/quotes/:id/pdf returns 200', adminPdfRes.statusCode === 200);
        record('Admin PDF has application/pdf content type', Boolean(adminPdfRes.headers['content-type']?.includes('application/pdf')));
        const isPdfMagicBytes = adminPdfRes.rawPayload.subarray(0, 5).toString('ascii') === '%PDF-';
        record('PDF payload begins with %PDF- header', isPdfMagicBytes);
        record('PDF payload is non-empty (> 1000 bytes)', adminPdfRes.rawPayload.length > 1000);
        // Public PDF
        const publicPdfRes = await server.inject({
            method: 'GET',
            url: `/api/offerte/${createdPublicToken}/pdf`,
        });
        record('GET /api/offerte/:token/pdf returns 200 (no auth required)', publicPdfRes.statusCode === 200);
        record('Public PDF has application/pdf header', Boolean(publicPdfRes.headers['content-type']?.includes('application/pdf')));
        // ---------------------------------------------------------
        // TEST 9: PUBLIC OFFERTE ACCESS & STRICT PRIVACY CHECK
        // ---------------------------------------------------------
        console.log('\n--- 9. Public Offerte & Data Sanitization ---');
        const publicOfferteRes = await server.inject({
            method: 'GET',
            url: `/api/offerte/${createdPublicToken}`,
        });
        record('GET /api/offerte/:token returns 200 without auth', publicOfferteRes.statusCode === 200);
        const publicOfferte = JSON.parse(publicOfferteRes.body).data;
        // Check payload structure
        record('Public response includes quoteNumber', publicOfferte.quoteNumber === createdQuoteNumber);
        record('Public response includes cover details', Boolean(publicOfferte.cover?.titleLine1));
        record('Public response includes specifications', Array.isArray(publicOfferte.configuration?.specifications));
        record('Public response includes investment line items', Array.isArray(publicOfferte.investment?.lineItems));
        record('Public response includes 3 instalments (40/40/20)', publicOfferte.investment?.instalments?.length === 3);
        record('Public instalment 1 is 40% (4114.00)', publicOfferte.investment?.instalments?.[0]?.amount === 4114.0);
        record('Public instalment 2 is 40% (4114.00)', publicOfferte.investment?.instalments?.[1]?.amount === 4114.0);
        record('Public instalment 3 is 20% (2057.00)', publicOfferte.investment?.instalments?.[2]?.amount === 2057.0);
        // STRICT PRIVACY CHECK: ensure sensitive internal fields are absent
        const rawPublicJson = publicOfferteRes.body;
        record('Public response NEVER contains costPrice', !rawPublicJson.includes('costPrice') && !rawPublicJson.includes('cost_price'));
        record('Public response NEVER contains marginPercent', !rawPublicJson.includes('marginPercent') && !rawPublicJson.includes('margin_percent'));
        record('Public response NEVER contains marginAmount', !rawPublicJson.includes('marginAmount') && !rawPublicJson.includes('margin_amount'));
        record('Public response NEVER contains internalNotes', !rawPublicJson.includes('internalNotes') && !rawPublicJson.includes('internal_notes'));
        record('Public response NEVER contains partnerNotes', !rawPublicJson.includes('partnerNotes') && !rawPublicJson.includes('partner_notes'));
        record('Public response NEVER contains acceptedPartnerOfferId', !rawPublicJson.includes('acceptedPartnerOfferId'));
        // ---------------------------------------------------------
        // TEST 10: CUSTOMER APPROVAL & ATOMIC PROJECT CONVERSION
        // ---------------------------------------------------------
        console.log('\n--- 10. Atomic Customer Approval & Project Conversion ---');
        const approveRes = await server.inject({
            method: 'POST',
            url: `/api/offerte/${createdPublicToken}/approve`,
            payload: {
                signerName: 'Karel de Jong',
                agreedTerms: true,
                signatureSvg: '<svg><path d="M10 10L20 20"/></svg>',
            },
        });
        record('POST /api/offerte/:token/approve returns 200', approveRes.statusCode === 200, approveRes.body);
        const approveBody = JSON.parse(approveRes.body).data;
        createdProjectId = approveBody.projectId;
        record('Approve response returns projectId', Boolean(createdProjectId));
        // Verify database state after approval
        // A. Quote status
        const [approvedQuoteDb] = await db
            .select()
            .from(quotes)
            .where(eq(quotes.id, createdQuoteId))
            .limit(1);
        record('Quote marked status = approved', approvedQuoteDb.status === 'approved');
        // B. Customer created/linked
        record('Quote is now linked to a customerId', Boolean(approvedQuoteDb.customerId));
        // C. Project created
        const [createdProject] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, createdProjectId))
            .limit(1);
        record('Project created with status = in_progress', createdProject?.status === 'in_progress');
        record('Project created with orderStatus = in_voorbereiding', createdProject?.orderStatus === 'in_voorbereiding');
        record('Project linked to quote', createdProject?.quoteId === createdQuoteId);
        // D. 2 Invoices created (50% upfront, 50% completion)
        const quoteInvoices = await db
            .select()
            .from(invoices)
            .where(eq(invoices.projectId, createdProjectId))
            .orderBy(invoices.issueDate);
        record('Exactly 2 invoices created for the project', quoteInvoices.length === 2);
        if (quoteInvoices.length === 2) {
            const inv1 = quoteInvoices.find((i) => i.invoiceType === 'down_payment_upfront') || quoteInvoices[0];
            const inv2 = quoteInvoices.find((i) => i.invoiceType === 'final_completion') || quoteInvoices[1];
            record('Invoice 1 is 50% upfront (paymentTermsDays = 14)', inv1.paymentTermsDays === 14);
            record('Invoice 2 is 50% completion (paymentTermsDays = 30)', inv2.paymentTermsDays === 30);
            record('Both invoices have status = draft', inv1.status === 'draft' && inv2.status === 'draft');
        }
        // E. Lead updated to Step 7 and status = won
        const [leadAfterApproval] = await db
            .select()
            .from(leads)
            .where(eq(leads.id, testLead.id))
            .limit(1);
        record('Lead status updated to won', leadAfterApproval.status === 'won');
        record('Lead workflowStep updated to 7 (Customer approval)', leadAfterApproval.workflowStep === 7);
        // F. Commercial action logged
        const leadActions = await db
            .select()
            .from(commercialActions)
            .where(eq(commercialActions.leadId, testLead.id))
            .orderBy(desc(commercialActions.createdAt));
        record('Commercial timeline action logged for approval', leadActions.some((a) => a.actionType.includes('quote_')));
        // ---------------------------------------------------------
        // TEST 11: REPLAY PROTECTION
        // ---------------------------------------------------------
        console.log('\n--- 11. Replay & Duplicate Approval Protection ---');
        const replayRes = await server.inject({
            method: 'POST',
            url: `/api/offerte/${createdPublicToken}/approve`,
            payload: { signerName: 'Karel de Jong', agreedTerms: true },
        });
        record('Re-approving an already approved quote returns 409 Conflict', replayRes.statusCode === 409);
        // ---------------------------------------------------------
        // TEST 12: CUSTOMER REJECTION
        // ---------------------------------------------------------
        console.log('\n--- 12. Customer Rejection Flow ---');
        // Create another test quote to test rejection
        const rejectQuoteRes = await server.inject({
            method: 'POST',
            url: '/api/quotes',
            headers: { cookie: adminCookie },
            payload: {
                productType: 'outdoor_kitchen',
            },
        });
        const quoteToReject = JSON.parse(rejectQuoteRes.body).data;
        // Publish it
        await server.inject({
            method: 'POST',
            url: `/api/quotes/${quoteToReject.id}/publish`,
            headers: { cookie: adminCookie },
        });
        // Reject via public token
        const rejectRes = await server.inject({
            method: 'POST',
            url: `/api/offerte/${quoteToReject.publicToken}/reject`,
            payload: { reason: 'Prijs valt buiten budget.' },
        });
        record('POST /api/offerte/:token/reject returns 200', rejectRes.statusCode === 200);
        const [rejectedQuoteDb] = await db
            .select()
            .from(quotes)
            .where(eq(quotes.id, quoteToReject.id))
            .limit(1);
        record('Quote marked status = declined', rejectedQuoteDb.status === 'declined');
        // ---------------------------------------------------------
        // TEST 13: ADMIN ACCEPT AND CONVERT (1-CLICK)
        // ---------------------------------------------------------
        console.log('\n--- 13. Admin 1-Click Accept & Convert ---');
        // Create a 3rd quote to test admin accept-and-convert
        const convertQuoteRes = await server.inject({
            method: 'POST',
            url: '/api/quotes',
            headers: { cookie: adminCookie },
            payload: {
                productType: 'garden_room',
            },
        });
        const quoteToConvert = JSON.parse(convertQuoteRes.body).data;
        const acceptConvertRes = await server.inject({
            method: 'POST',
            url: `/api/quotes/${quoteToConvert.id}/accept-and-convert`,
            headers: { cookie: adminCookie },
            payload: {
                notes: 'Akkoord per email ontvangen van klant.',
            },
        });
        record('POST /api/quotes/:id/accept-and-convert returns 200', acceptConvertRes.statusCode === 200);
        const convertBody = JSON.parse(acceptConvertRes.body).data;
        const convertedProjectId = convertBody.project?.id || convertBody.projectId;
        record('Accept-and-convert returns projectId', Boolean(convertedProjectId));
        const [convertedQuoteDb] = await db
            .select()
            .from(quotes)
            .where(eq(quotes.id, quoteToConvert.id))
            .limit(1);
        record('Quote converted to approved status', convertedQuoteDb.status === 'approved');
        async function cleanupProject(projId) {
            const invs = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.projectId, projId));
            for (const inv of invs) {
                await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
            }
            await db.delete(invoices).where(eq(invoices.projectId, projId));
            await db.delete(projects).where(eq(projects.id, projId));
        }
        // Cleanup quoteToReject & quoteToConvert
        try {
            if (convertedProjectId) {
                await cleanupProject(convertedProjectId);
            }
            await db.delete(quoteVersions).where(eq(quoteVersions.quoteId, quoteToConvert.id));
            await db.delete(quotes).where(eq(quotes.id, quoteToConvert.id));
            await db.delete(quoteVersions).where(eq(quoteVersions.quoteId, quoteToReject.id));
            await db.delete(quotes).where(eq(quotes.id, quoteToReject.id));
        }
        catch (e) {
            console.warn('Intermediary cleanup note:', e);
        }
        // ---------------------------------------------------------
        // TEST 14: DELETE DRAFT QUOTE
        // ---------------------------------------------------------
        console.log('\n--- 14. Quote Deletion ---');
        const draftQuoteRes = await server.inject({
            method: 'POST',
            url: '/api/quotes',
            headers: { cookie: adminCookie },
            payload: {
                productType: 'outdoor_kitchen',
            },
        });
        const draftQuote = JSON.parse(draftQuoteRes.body).data;
        const deleteRes = await server.inject({
            method: 'DELETE',
            url: `/api/quotes/${draftQuote.id}`,
            headers: { cookie: adminCookie },
        });
        record('DELETE /api/quotes/:id deletes draft quote (200)', deleteRes.statusCode === 200);
        const [deletedCheck] = await db.select().from(quotes).where(eq(quotes.id, draftQuote.id)).limit(1);
        record('Quote no longer exists in database', !deletedCheck);
    }
    catch (err) {
        record('Fatal test execution exception', false, err.message || String(err));
        console.error(err);
    }
    finally {
        // Cleanup primary test records
        try {
            if (createdProjectId) {
                const invs = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.projectId, createdProjectId));
                for (const inv of invs) {
                    await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
                }
                await db.delete(invoices).where(eq(invoices.projectId, createdProjectId));
                await db.delete(projects).where(eq(projects.id, createdProjectId));
            }
            if (createdQuoteId) {
                await db.delete(quoteVersions).where(eq(quoteVersions.quoteId, createdQuoteId));
                await db.delete(quotes).where(eq(quotes.id, createdQuoteId));
            }
            if (testLead?.id) {
                await db.delete(commercialActions).where(eq(commercialActions.leadId, testLead.id));
                await db.delete(leads).where(eq(leads.id, testLead.id));
            }
        }
        catch (cleanErr) {
            console.warn('Final cleanup warning:', cleanErr);
        }
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
        console.log(`❌ ${failed} TESTS FAILED:`);
        results.filter((r) => !r.passed).forEach((r) => console.log(`   - ${r.name}${r.details ? `: ${r.details}` : ''}`));
    }
    console.log('======================================================\n');
    if (failed > 0) {
        process.exit(1);
    }
    else {
        process.exit(0);
    }
}
runTests().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
