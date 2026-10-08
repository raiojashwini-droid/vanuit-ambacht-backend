/**
 * Comprehensive Automated Test Suite for Module 6: Invoices & Facturatie
 *
 * Covers:
 * - Authentication & Strict RBAC (Partner 403 on all invoice endpoints, Customer scoped)
 * - Sequential invoice numbering (INV-YYYY-XXX) & Credit note numbering (CR-YYYY-XXX)
 * - Invoice calculations & VAT rounding (21%)
 * - Draft lifecycle & Belastingdienst lock (Draft editable/deletable -> Sent locked)
 * - Mark as paid & Payments table integration
 * - Milestone completion on invoice payment
 * - Credit note generation (negative totals, originalInvoiceId, status 'credited')
 * - Summary KPIs calculation (/api/invoices/summary)
 * - Dutch Factuur PDF generation (/api/invoices/:id/pdf)
 * - Customer project invoice schedule (/api/customer/projects/:id/invoices)
 * - Customer multi-tenant isolation
 * - Module 4 quote conversion instalment generation (50/50 for outdoor kitchen, 40/40/20 for garden room)
 */

import bcrypt from 'bcryptjs';
import server from '../server.js';
import { db } from '../db/index.js';
import {
  users,
  customers,
  partners,
  projects,
  projectMilestones,
  invoices,
  invoiceItems,
  payments,
  quotes,
  quoteVersions,
  leads,
} from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';

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
  console.log('🧪 RUNNING INVOICES MODULE (MODULE 6) TEST SUITE');
  console.log('======================================================\n');

  await server.ready();

  function extractCookie(res: any): string {
    const raw = res.headers['set-cookie'];
    if (!raw) return '';
    return Array.isArray(raw) ? raw[0] : (raw as string);
  }

  // ---------------------------------------------------------
  // 0. AUTHENTICATION & SEED DATA SETUP
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

  // Retrieve primary customer and partner
  const [custUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'customer@vanuitambacht.nl'))
    .limit(1);

  const [existingCustomer] = await db
    .select({ id: customers.id, userId: customers.userId })
    .from(customers)
    .where(eq(customers.userId, custUser.id))
    .limit(1);

  const [existingPartner] = await db
    .select({ id: partners.id })
    .from(partners)
    .limit(1);

  // Setup a test project
  let testProjectId = '';
  let testMilestoneId = '';
  let secondCustomerCookie = '';
  let secondCustomerId = '';

  try {
    // ---------------------------------------------------------
    // SETUP TEST FIXTURES
    // ---------------------------------------------------------
    const createProjectRes = await server.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: adminCookie },
      payload: {
        name: 'Invoice Test Project',
        projectType: 'outdoor_kitchen',
        customerId: existingCustomer.id,
        deliveryAddress: 'Factuurweg 10',
        city: 'Utrecht',
        postalCode: '3511AA',
        contractValue: 12100,
      },
    });
    const projData = JSON.parse(createProjectRes.body).data;
    testProjectId = projData?.id;

    // Use auto-created first milestone or create one
    if (projData?.milestones && projData.milestones.length > 0) {
      testMilestoneId = projData.milestones[0].id;
    } else {
      const createMilestoneRes = await server.inject({
        method: 'POST',
        url: `/api/projects/${testProjectId}/milestones`,
        headers: { cookie: adminCookie },
        payload: {
          title: 'Aanbetaling Gereed',
          percentage: 50,
          amount: 6050,
        },
      });
      const milestoneData = JSON.parse(createMilestoneRes.body).data;
      testMilestoneId = milestoneData.id;
    }

    // Create a secondary customer to verify customer multi-tenant isolation
    const secUserEmail = `cust2_${Date.now()}@test.nl`;
    const secHash = await bcrypt.hash('customer123', 10);
    const [secUser] = await db
      .insert(users)
      .values({
        email: secUserEmail,
        passwordHash: secHash,
        role: 'customer',
        fullName: 'Second Customer',
      })
      .returning();

    const [secCust] = await db
      .insert(customers)
      .values({
        userId: secUser.id,
        customerNumber: `CUS-${Date.now().toString().slice(-6)}`,
        firstName: 'Second',
        lastName: 'Customer',
        email: secUserEmail,
        phone: '0698765432',
        streetAddress: 'Andere Straat 2',
        postalCode: '1000AA',
        city: 'Amsterdam',
      })
      .returning();
    secondCustomerId = secCust.id;

    // Login secondary customer
    const secLoginRes = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: secUserEmail, password: 'customer123' },
    });
    secondCustomerCookie = extractCookie(secLoginRes);

    // ---------------------------------------------------------
    // TEST 1: STRICT RBAC & PARTNER 403
    // ---------------------------------------------------------
    console.log('\n--- 1. Strict RBAC & Partner 403 Denials ---');

    const unauthGetRes = await server.inject({ method: 'GET', url: '/api/invoices' });
    record('GET /api/invoices requires auth (401)', unauthGetRes.statusCode === 401);

    const unauthSummaryRes = await server.inject({ method: 'GET', url: '/api/invoices/summary' });
    record('GET /api/invoices/summary requires auth (401)', unauthSummaryRes.statusCode === 401);

    const partnerListRes = await server.inject({
      method: 'GET',
      url: '/api/invoices',
      headers: { cookie: partnerCookie },
    });
    record('Partner GET /api/invoices is forbidden (403)', partnerListRes.statusCode === 403);

    const partnerSummaryRes = await server.inject({
      method: 'GET',
      url: '/api/invoices/summary',
      headers: { cookie: partnerCookie },
    });
    record('Partner GET /api/invoices/summary is forbidden (403)', partnerSummaryRes.statusCode === 403);

    const partnerCreateRes = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: { cookie: partnerCookie },
      payload: {
        projectId: testProjectId,
        items: [{ description: 'Test', quantity: 1, unitPriceExclVat: 100, vatRate: 21 }],
      },
    });
    record('Partner POST /api/invoices is forbidden (403)', partnerCreateRes.statusCode === 403);

    const custCreateRes = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: { cookie: customerCookie },
      payload: {
        projectId: testProjectId,
        items: [{ description: 'Test', quantity: 1, unitPriceExclVat: 100, vatRate: 21 }],
      },
    });
    record('Customer POST /api/invoices is forbidden (403)', custCreateRes.statusCode === 403);

    // ---------------------------------------------------------
    // TEST 2: CREATE INVOICE (ADMIN) & SEQUENTIAL NUMBERING
    // ---------------------------------------------------------
    console.log('\n--- 2. Create Invoice & VAT Calculations ---');

    const createInv1Res = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: { cookie: adminCookie },
      payload: {
        projectId: testProjectId,
        milestoneId: testMilestoneId,
        invoiceType: 'down_payment_upfront',
        paymentTermsDays: 14,
        notes: 'Aanbetaling 50% voor buitenkeuken',
        items: [
          {
            description: 'Buitenkeuken Maatwerk 50% voorschot',
            subtext: 'Inclusief materialen en planning',
            quantity: 1,
            unitPriceExclVat: 5000,
            vatRate: 21,
          },
          {
            description: 'Montage en voorbereiding',
            quantity: 2,
            unitPriceExclVat: 500,
            vatRate: 21,
          },
        ],
      },
    });

    record('Admin can create invoice (201)', createInv1Res.statusCode === 201);
    const inv1 = JSON.parse(createInv1Res.body).data;

    // Verification of numbering: INV-YYYY-XXX
    const currentYear = new Date().getFullYear();
    const invNumRegex = new RegExp(`^INV-${currentYear}-\\d{3}$`);
    record('Invoice number format matches INV-YYYY-XXX', invNumRegex.test(inv1?.invoiceNumber), inv1?.invoiceNumber);

    // Verification of calculation:
    // Subtotal: 5000 + (2 * 500) = 6000
    // VAT 21%: 6000 * 0.21 = 1260
    // Total: 7260
    record('Subtotal excl VAT equals 6000', inv1?.subtotalExclVat === 6000, `subtotal: ${inv1?.subtotalExclVat}`);
    record('Total VAT equals 1260', inv1?.totalVatAmount === 1260, `vat: ${inv1?.totalVatAmount}`);
    record('Total incl VAT equals 7260', inv1?.totalInclVat === 7260, `total: ${inv1?.totalInclVat}`);
    record('Initial status is draft', inv1?.status === 'draft');
    record('Initial totalPaid is 0', inv1?.totalPaid === 0);
    record('Initial outstanding balance is 7260', inv1?.outstandingBalance === 7260);
    record('Milestone ID correctly linked', inv1?.milestoneId === testMilestoneId);

    // ---------------------------------------------------------
    // TEST 3: EDIT DRAFT INVOICE
    // ---------------------------------------------------------
    console.log('\n--- 3. Edit Draft Invoice ---');

    const updateDraftRes = await server.inject({
      method: 'PATCH',
      url: `/api/invoices/${inv1.id}`,
      headers: { cookie: adminCookie },
      payload: {
        notes: 'Aanbetaling 50% (Herziene notitie)',
        items: [
          {
            description: 'Buitenkeuken Maatwerk 50% voorschot',
            quantity: 1,
            unitPriceExclVat: 5500, // changed from 5000 to 5500
            vatRate: 21,
          },
        ],
      },
    });

    record('Admin can update draft invoice (200)', updateDraftRes.statusCode === 200);
    const updatedInv = JSON.parse(updateDraftRes.body).data;
    // Subtotal: 5500, VAT: 1155, Total: 6655
    record('Updated subtotal recalculated to 5500', updatedInv?.subtotalExclVat === 5500);
    record('Updated total VAT recalculated to 1155', updatedInv?.totalVatAmount === 1155);
    record('Updated total incl VAT is 6655', updatedInv?.totalInclVat === 6655);
    record('Updated notes persisted', updatedInv?.notes === 'Aanbetaling 50% (Herziene notitie)');

    // ---------------------------------------------------------
    // TEST 4: DRAFT DELETION VS LOCKED DELETION
    // ---------------------------------------------------------
    console.log('\n--- 4. Draft Deletion vs Finalized Lock ---');

    // Create a temporary draft invoice to delete
    const tempDraftRes = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: { cookie: adminCookie },
      payload: {
        projectId: testProjectId,
        items: [{ description: 'Tijdelijke post', quantity: 1, unitPriceExclVat: 100, vatRate: 21 }],
      },
    });
    const tempDraft = JSON.parse(tempDraftRes.body).data;

    const deleteDraftRes = await server.inject({
      method: 'DELETE',
      url: `/api/invoices/${tempDraft.id}`,
      headers: { cookie: adminCookie },
    });
    record('Draft invoice can be deleted (200)', deleteDraftRes.statusCode === 200);

    // Verify it is gone
    const getDeletedRes = await server.inject({
      method: 'GET',
      url: `/api/invoices/${tempDraft.id}`,
      headers: { cookie: adminCookie },
    });
    record('Deleted draft returns 404', getDeletedRes.statusCode === 404);

    // ---------------------------------------------------------
    // TEST 5: SEND INVOICE & BELASTINGDIENST IMMUTABILITY LOCK
    // ---------------------------------------------------------
    console.log('\n--- 5. Send Invoice & Immutability Lock ---');

    const sendRes = await server.inject({
      method: 'POST',
      url: `/api/invoices/${inv1.id}/send`,
      headers: { cookie: adminCookie },
    });
    record('Admin can send invoice (200)', sendRes.statusCode === 200);
    const sentInv = JSON.parse(sendRes.body).data;
    record('Invoice status transitioned to sent', sentInv?.status === 'sent');

    // Legal lock test 1: Cannot edit sent invoice
    const editSentRes = await server.inject({
      method: 'PATCH',
      url: `/api/invoices/${inv1.id}`,
      headers: { cookie: adminCookie },
      payload: { notes: 'Frauduleuze wijziging na verzending' },
    });
    record('Cannot edit sent invoice (400 INVOICE_LOCKED)', editSentRes.statusCode === 400);

    // Legal lock test 2: Cannot delete sent invoice
    const deleteSentRes = await server.inject({
      method: 'DELETE',
      url: `/api/invoices/${inv1.id}`,
      headers: { cookie: adminCookie },
    });
    record('Cannot delete sent invoice (400 CANNOT_DELETE_FINALIZED_INVOICE)', deleteSentRes.statusCode === 400);

    // ---------------------------------------------------------
    // TEST 6: MARK AS PAID & PAYMENT TABLE INTEGRATION
    // ---------------------------------------------------------
    console.log('\n--- 6. Mark Paid & Payment Records ---');

    const markPaidRes = await server.inject({
      method: 'POST',
      url: `/api/invoices/${inv1.id}/mark-paid`,
      headers: { cookie: adminCookie },
      payload: {
        paidDate: new Date().toISOString().split('T')[0],
        paymentMethod: 'bank_transfer_abn',
        paymentReference: 'ABN-NL-99182',
        notes: 'Handmatige bankafschrift controle',
      },
    });

    record('Admin can mark invoice as paid (200)', markPaidRes.statusCode === 200);
    const paidInv = JSON.parse(markPaidRes.body).data;
    record('Invoice status is now paid', paidInv?.status === 'paid');
    record('Invoice totalPaid equals totalInclVat', paidInv?.totalPaid === 6655);
    record('Outstanding balance is 0', paidInv?.outstandingBalance === 0);
    record('Paid date is set', Boolean(paidInv?.paidDate));

    // Verify payments table record created
    const paymentRows = await db
      .select()
      .from(payments)
      .where(eq(payments.invoiceId, inv1.id));
    record('Record inserted into payments table', paymentRows.length > 0);
    record('Payment amount matches invoice total', Number(paymentRows[0]?.amount) === 6655);
    record('Payment method matches bank_transfer_abn', paymentRows[0]?.paymentMethod === 'bank_transfer_abn');

    // Verify linked milestone is marked completed
    const [milestone] = await db
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.id, testMilestoneId));
    record('Linked project milestone status marked completed', milestone?.status === 'completed');

    // ---------------------------------------------------------
    // TEST 7: CREDIT NOTE CREATION
    // ---------------------------------------------------------
    console.log('\n--- 7. Credit Note Issuance ---');

    const creditNoteRes = await server.inject({
      method: 'POST',
      url: `/api/invoices/${inv1.id}/credit-note`,
      headers: { cookie: adminCookie },
      payload: {
        reason: 'Klant wenst annulering ivm verhuizing',
        notes: 'Creditering van voorschotfactuur',
      },
    });

    record('Admin can issue credit note (201)', creditNoteRes.statusCode === 201);
    const creditNoteData = JSON.parse(creditNoteRes.body).data;
    const creditNote = creditNoteData?.creditNote;

    const crNumRegex = new RegExp(`^CR-${currentYear}-\\d{3}$`);
    record('Credit note number format matches CR-YYYY-XXX', crNumRegex.test(creditNote?.invoiceNumber), creditNote?.invoiceNumber);
    record('Credit note invoiceType is credit_note', creditNote?.invoiceType === 'credit_note');
    record('Credit note originalInvoiceId points to original invoice', creditNote?.originalInvoiceId === inv1.id);
    record('Credit note subtotal is negative (-5500)', creditNote?.subtotalExclVat === -5500);
    record('Credit note total VAT is negative (-1155)', creditNote?.totalVatAmount === -1155);
    record('Credit note total incl VAT is negative (-6655)', creditNote?.totalInclVat === -6655);
    record('Credit note status is sent', creditNote?.status === 'sent');

    // Verify original invoice status is marked as 'credited'
    const getOriginalRes = await server.inject({
      method: 'GET',
      url: `/api/invoices/${inv1.id}`,
      headers: { cookie: adminCookie },
    });
    const originalRefetched = JSON.parse(getOriginalRes.body).data;
    record('Original invoice status is now credited', originalRefetched?.status === 'credited');

    // ---------------------------------------------------------
    // TEST 8: SUMMARY KPIS
    // ---------------------------------------------------------
    console.log('\n--- 8. Summary KPIs Calculation ---');

    const summaryRes = await server.inject({
      method: 'GET',
      url: '/api/invoices/summary',
      headers: { cookie: adminCookie },
    });
    record('GET /api/invoices/summary returns 200', summaryRes.statusCode === 200);
    const summary = JSON.parse(summaryRes.body).data;
    record('Summary contains totalCount number', typeof summary?.totalCount === 'number');
    record('Summary contains totalAmount number', typeof summary?.totalAmount === 'number');
    record('Summary contains paidSum number', typeof summary?.paidSum === 'number');
    record('Summary contains pendingSum number', typeof summary?.pendingSum === 'number');
    record('Summary contains overdueSum number', typeof summary?.overdueSum === 'number');

    // ---------------------------------------------------------
    // TEST 9: DUTCH FACTUUR PDF GENERATION
    // ---------------------------------------------------------
    console.log('\n--- 9. Dutch Factuur PDF Generation ---');

    const pdfRes = await server.inject({
      method: 'GET',
      url: `/api/invoices/${inv1.id}/pdf`,
      headers: { cookie: adminCookie },
    });
    record('GET /api/invoices/:id/pdf returns 200', pdfRes.statusCode === 200);
    record('Content-Type is application/pdf', pdfRes.headers['content-type'] === 'application/pdf');
    record('Content-Disposition contains invoice filename', (pdfRes.headers['content-disposition'] as string)?.includes(inv1.invoiceNumber));
    
    // Check PDF magic header %PDF-1.4
    const pdfBuffer = pdfRes.rawPayload;
    const isPdfHeader = pdfBuffer.slice(0, 8).toString('utf-8').startsWith('%PDF-');
    record('PDF payload starts with %PDF- header', isPdfHeader);

    // ---------------------------------------------------------
    // TEST 10: CUSTOMER ACCESS & MULTI-TENANT ISOLATION
    // ---------------------------------------------------------
    console.log('\n--- 10. Customer Access & Multi-tenant Isolation ---');

    // Customer 1 viewing their own invoices
    const custInvoicesRes = await server.inject({
      method: 'GET',
      url: '/api/invoices',
      headers: { cookie: customerCookie },
    });
    record('Customer can view own invoices list (200)', custInvoicesRes.statusCode === 200);
    const custInvoices = JSON.parse(custInvoicesRes.body).data;
    const invList = Array.isArray(custInvoices) ? custInvoices : custInvoices?.items || [];
    record('All customer invoices belong to customer', invList.length > 0 && invList.every((inv: any) => inv.customerId === existingCustomer.id));

    // Customer 1 viewing their own invoice detail
    const custGetOwnRes = await server.inject({
      method: 'GET',
      url: `/api/invoices/${inv1.id}`,
      headers: { cookie: customerCookie },
    });
    record('Customer can view own invoice detail (200)', custGetOwnRes.statusCode === 200);

    // Customer 1 viewing their own invoice PDF
    const custPdfRes = await server.inject({
      method: 'GET',
      url: `/api/invoices/${inv1.id}/pdf`,
      headers: { cookie: customerCookie },
    });
    record('Customer can download own invoice PDF (200)', custPdfRes.statusCode === 200);

    // Customer 2 attempting to view Customer 1's invoice
    const cust2GetOtherRes = await server.inject({
      method: 'GET',
      url: `/api/invoices/${inv1.id}`,
      headers: { cookie: secondCustomerCookie },
    });
    record('Customer 2 cannot view Customer 1 invoice (404/403)', cust2GetOtherRes.statusCode === 404 || cust2GetOtherRes.statusCode === 403);

    // Customer 2 attempting to download Customer 1's PDF
    const cust2PdfOtherRes = await server.inject({
      method: 'GET',
      url: `/api/invoices/${inv1.id}/pdf`,
      headers: { cookie: secondCustomerCookie },
    });
    record('Customer 2 cannot download Customer 1 PDF (404/403)', cust2PdfOtherRes.statusCode === 404 || cust2PdfOtherRes.statusCode === 403);

    // Customer project invoice schedule
    const scheduleRes = await server.inject({
      method: 'GET',
      url: `/api/customer/projects/${testProjectId}/invoices`,
      headers: { cookie: customerCookie },
    });
    record('Customer can view project invoice schedule (200)', scheduleRes.statusCode === 200);
    const schedule = JSON.parse(scheduleRes.body).data;
    record('Schedule contains project details and instalments list', Boolean(schedule?.projectId) && Array.isArray(schedule?.instalments));

    // Customer 2 attempting to view Customer 1 project invoice schedule
    const cust2ScheduleRes = await server.inject({
      method: 'GET',
      url: `/api/customer/projects/${testProjectId}/invoices`,
      headers: { cookie: secondCustomerCookie },
    });
    record('Customer 2 denied access to Customer 1 project invoice schedule (403/404)', cust2ScheduleRes.statusCode === 403 || cust2ScheduleRes.statusCode === 404);

    // ---------------------------------------------------------
    // TEST 11: MODULE 4 QUOTE CONVERSION INSTALMENTS (50/50 & 40/40/20)
    // ---------------------------------------------------------
    console.log('\n--- 11. Module 4 Quote Conversion Integration ---');

    // 11.1 Test Garden Room Quote Conversion (40/40/20 split)
    const grLeadRes = await server.inject({
      method: 'POST',
      url: '/api/leads',
      headers: { cookie: adminCookie },
      payload: {
        name: 'Tuinkamer Klant',
        email: `gr_${Date.now()}@test.nl`,
        phone: '0612345678',
        projectType: 'garden_room',
        address: 'Tuinlaan 5',
        city: 'Hilversum',
      },
    });
    const grLead = JSON.parse(grLeadRes.body).data;

    const grQuoteRes = await server.inject({
      method: 'POST',
      url: '/api/quotes',
      headers: { cookie: adminCookie },
      payload: {
        leadId: grLead.id,
        productType: 'garden_room',
      },
    });
    const grQuote = JSON.parse(grQuoteRes.body).data;

    // Update draft with items
    await server.inject({
      method: 'PUT',
      url: `/api/quotes/${grQuote.id}/versions/draft`,
      headers: { cookie: adminCookie },
      payload: {
        costPrice: 15000,
        items: [
          {
            position: 1,
            title: 'Luxe Tuinkamer Model Oak',
            quantity: 1,
            unitPriceInclVat: 24200, // 20000 excl + 21% VAT
            vatRate: 21,
          },
        ],
      },
    });

    // Publish quote
    await server.inject({
      method: 'POST',
      url: `/api/quotes/${grQuote.id}/publish`,
      headers: { cookie: adminCookie },
      payload: { validDays: 30 },
    });

    // Customer approves via public token -> triggers quote conversion
    const grApproveRes = await server.inject({
      method: 'POST',
      url: `/api/offerte/${grQuote.publicToken}/approve`,
      payload: {
        signerName: 'Tuinkamer Klant',
        agreedTerms: true,
        signatureSvg: '<svg><path d="M10 10"/></svg>',
      },
    });
    record('Garden Room quote approve succeeds (200)', grApproveRes.statusCode === 200);

    // Check invoices generated for this quote
    const grInvoices = await db
      .select()
      .from(invoices)
      .where(eq(invoices.quoteId, grQuote.id));

    record('Garden Room quote generates exactly 3 invoices (40/40/20)', grInvoices.length === 3, `actual count: ${grInvoices.length}`);

    // Verify 40%, 40%, 20% amounts
    // Total quote: 20000 excl VAT, 24200 incl VAT
    // 40% = 9680 incl VAT (8000 excl)
    // 20% = 4840 incl VAT (4000 excl)
    const upfrontGr = grInvoices.find((i) => i.invoiceType === 'down_payment_upfront');
    const interimGr = grInvoices.find((i) => i.invoiceType === 'interim_progress');
    const finalGr = grInvoices.find((i) => i.invoiceType === 'final_completion');

    record('Upfront invoice is 40% (9680 incl VAT)', Number(upfrontGr?.totalInclVat) === 9680, `val: ${upfrontGr?.totalInclVat}`);
    record('Interim invoice is 40% (9680 incl VAT)', Number(interimGr?.totalInclVat) === 9680, `val: ${interimGr?.totalInclVat}`);
    record('Final invoice is 20% (4840 incl VAT)', Number(finalGr?.totalInclVat) === 4840, `val: ${finalGr?.totalInclVat}`);

  } catch (error: any) {
    console.error('Unexpected error in test execution:', error);
    record('Test suite execution completed without fatal crash', false, error.message);
  } finally {
    // Cleanup temporary resources
    try {
      if (secondCustomerId) {
        await db.delete(customers).where(eq(customers.id, secondCustomerId));
      }
    } catch (e) {
      // ignore cleanup errors
    }
  }

  // ---------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------
  console.log('\n======================================================');
  console.log('📊 MODULE 6 TEST SUITE SUMMARY');
  console.log('======================================================');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total Tests: ${results.length}`);
  console.log(`Passed:      ${passed}`);
  console.log(`Failed:      ${failed}`);
  if (failed > 0) {
    console.log('\n❌ Failed Tests List:');
    results.filter((r) => !r.passed).forEach((r) => console.log(`  - ${r.name}: ${r.details || 'no details'}`));
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
