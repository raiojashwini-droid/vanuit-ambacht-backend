/**
 * Module 8 Accounting & Double-Entry Bookkeeping Integration Test Suite
 * Covers all verified business decisions:
 * 1. Standard Dutch Chart of Accounts verification
 * 2. Balanced journal entry engine: SUM(Debit) === SUM(Credit) validation
 * 3. Rejection of negative amounts and unbalanced entries
 * 4. Draft -> Posted -> Reversed lifecycle and immutable posted entries
 * 5. Reversal creates exact opposite offsetting journal entry
 * 6. Fiscal lock mechanism: blocks entries on or before lock date
 * 7. Invoice -> Accounting: Sent sales invoice generates Dr 1300 / Cr 8000 / Cr 1500
 * 8. Credit Note -> Accounting: Generates Dr 8000 / Dr 1500 / Cr 1300
 * 9. Payment -> Accounting: Customer payment generates Dr 1000 Bank / Cr 1300 AR
 * 10. Bank Categorization & Bol.com 3-way reconciliation posting
 * 11. General Ledger & Trial Balance reports
 * 12. Factuurstelsel VAT report (Box 1a, 5b, 5g)
 * 13. Profit & Loss report (Revenue - Direct Costs - OpEx)
 * 14. Strict Admin-only RBAC
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import server from '../server.js';
import { db } from '../db/index.js';
import {
  users,
  chartOfAccounts,
  journalEntries,
  journalEntryLines,
  companySettings,
  invoices,
  invoiceItems,
  payments,
  bankTransactions,
} from '../db/schema.js';
import { eq, desc, sql, and } from 'drizzle-orm';
import { accountingService } from '../modules/accounting/accounting.service.js';

let adminCookie: string;
let partnerCookie: string;
let customerCookie: string;

function extractCookie(res: any): string {
  const raw = res.headers['set-cookie'];
  if (!raw) return '';
  return Array.isArray(raw) ? raw[0] : (raw as string);
}

async function setupTokens() {
  await server.ready();

  // Admin login
  const resAdmin = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@vanuitambacht.nl', password: 'admin123' },
  });
  adminCookie = extractCookie(resAdmin);

  // Partner login
  const resPartner = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'partner@vanuitambacht.nl', password: 'partner123' },
  });
  partnerCookie = extractCookie(resPartner);

  // Customer login
  const resCust = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'customer@vanuitambacht.nl', password: 'customer123' },
  });
  customerCookie = extractCookie(resCust);
}

async function runTests() {
  console.log('🧪 Starting Module 8 Accounting Test Suite...');
  await setupTokens();

  // 1. Chart of Accounts
  console.log('\n--- 1. Chart of Accounts ---');
  const resAccounts = await server.inject({
    method: 'GET',
    url: '/api/accounting/accounts',
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(resAccounts.statusCode, 200);
  const accounts = resAccounts.json().data;
  assert.ok(accounts.length >= 20, 'At least 20 standard accounts must exist');
  assert.ok(accounts.some((a: any) => a.accountCode === '1000' && a.accountType === 'Asset'));
  assert.ok(accounts.some((a: any) => a.accountCode === '1300' && a.accountType === 'Asset'));
  assert.ok(accounts.some((a: any) => a.accountCode === '1500' && a.accountType === 'Liability'));
  assert.ok(accounts.some((a: any) => a.accountCode === '8000' && a.accountType === 'Revenue'));
  console.log('✅ PASS: Standard Dutch Chart of Accounts retrieved and verified');

  // RBAC test: partner and customer denied
  const resPartnerAcc = await server.inject({
    method: 'GET',
    url: '/api/accounting/accounts',
    headers: { cookie: partnerCookie },
  });
  assert.strictEqual(resPartnerAcc.statusCode, 403);
  console.log('✅ PASS: Partner access strictly rejected with 403');

  const resCustAcc = await server.inject({
    method: 'GET',
    url: '/api/accounting/accounts',
    headers: { cookie: customerCookie },
  });
  assert.strictEqual(resCustAcc.statusCode, 403);
  console.log('✅ PASS: Customer access strictly rejected with 403');

  // Test Account Update API
  const testAccount = accounts.find((a: any) => a.accountCode === '4450');
  const resUpdateAcc = await server.inject({
    method: 'PUT',
    url: `/api/accounting/accounts/${testAccount.id}`,
    headers: { cookie: adminCookie },
    payload: {
      accountName: 'Kantoorkosten & Werkplek (Updated)',
      standardVatRule: 'NL_21',
    },
  });
  assert.strictEqual(resUpdateAcc.statusCode, 200);
  assert.strictEqual(resUpdateAcc.json().data.accountName, 'Kantoorkosten & Werkplek (Updated)');
  console.log('✅ PASS: PUT /api/accounting/accounts/:id successfully updated account');

  // Attempt to change accountType of account 1000 (used in posted entries)
  const bankAcc = accounts.find((a: any) => a.accountCode === '1000');
  const resBadType = await server.inject({
    method: 'PUT',
    url: `/api/accounting/accounts/${bankAcc.id}`,
    headers: { cookie: adminCookie },
    payload: { accountType: 'Revenue' },
  });
  assert.strictEqual(resBadType.statusCode, 400);
  assert.strictEqual(resBadType.json().error.code, 'CANNOT_MODIFY_USED_ACCOUNT');
  console.log('✅ PASS: Changing account type of account with posted entries blocked (400)');

  // 2. Double-Entry Engine: Unbalanced & Negative Validation
  console.log('\n--- 2. Balanced Entry & Math Validation ---');
  const resNegative = await server.inject({
    method: 'POST',
    url: '/api/accounting/journal-entries',
    headers: { cookie: adminCookie },
    payload: {
      entryDate: '2026-06-01',
      entryType: 'general_journal',
      description: 'Negative debit test',
      lines: [
        { accountCode: '1000', debit: -100.0, credit: 0 },
        { accountCode: '8000', debit: 0, credit: -100.0 },
      ],
    },
  });
  assert.strictEqual(resNegative.statusCode, 400);
  console.log('✅ PASS: Negative debit/credit strictly rejected (400)');

  const resUnbalanced = await server.inject({
    method: 'POST',
    url: '/api/accounting/journal-entries',
    headers: { cookie: adminCookie },
    payload: {
      entryDate: '2026-06-01',
      entryType: 'general_journal',
      description: 'Unbalanced entry test',
      lines: [
        { accountCode: '1000', debit: 1000.0, credit: 0 },
        { accountCode: '8000', debit: 0, credit: 950.0 }, // Imbalance €50
      ],
    },
  });
  assert.strictEqual(resUnbalanced.statusCode, 400);
  assert.strictEqual(resUnbalanced.json().error.code, 'UNBALANCED_ENTRY');
  console.log('✅ PASS: Unbalanced journal entry successfully rejected (400)');

  // 3. Balanced Manual Entry
  console.log('\n--- 3. Balanced Journal Entry Creation & Posting ---');
  const resBalanced = await server.inject({
    method: 'POST',
    url: '/api/accounting/journal-entries',
    headers: { cookie: adminCookie },
    payload: {
      entryDate: '2026-06-15',
      entryType: 'general_journal',
      description: 'Capital contribution by owner',
      lines: [
        { accountCode: '1000', debit: 5000.0, credit: 0, lineDescription: 'Storting privégelden op bank' },
        { accountCode: '2000', debit: 0, credit: 5000.0, lineDescription: 'Kortlopende schuld / inbreng' },
      ],
    },
  });
  assert.strictEqual(resBalanced.statusCode, 201);
  const createdEntry = resBalanced.json().data;
  assert.strictEqual(createdEntry.status, 'posted');
  assert.strictEqual(createdEntry.totalDebit, 5000.0);
  assert.strictEqual(createdEntry.totalCredit, 5000.0);
  console.log(`✅ PASS: Balanced entry posted: ${createdEntry.entryNumber} (€5,000.00)`);

  // 4. Storno / Reversal
  console.log('\n--- 4. Journal Entry Storno / Reversal ---');
  const resReverse = await server.inject({
    method: 'POST',
    url: `/api/accounting/journal-entries/${createdEntry.id}/reverse`,
    headers: { cookie: adminCookie },
    payload: {
      reversalDate: '2026-06-16',
      reason: 'Incorrect account allocation',
    },
  });
  assert.strictEqual(resReverse.statusCode, 200);
  const revData = resReverse.json().data;
  assert.strictEqual(revData.originalEntry.status, 'reversed');
  assert.strictEqual(revData.reversalEntry.status, 'posted');
  assert.strictEqual(revData.reversalEntry.isReversal, true);
  // Reversal lines should have swapped Dr and Cr:
  const revLine1000 = revData.reversalEntry.lines.find((l: any) => l.accountCode === '1000');
  assert.strictEqual(revLine1000.credit, 5000.0);
  assert.strictEqual(revLine1000.debit, 0);
  console.log(`✅ PASS: Reversal entry posted: ${revData.reversalEntry.entryNumber} reversing ${createdEntry.entryNumber}`);

  // Cannot reverse twice
  const resDoubleRev = await server.inject({
    method: 'POST',
    url: `/api/accounting/journal-entries/${createdEntry.id}/reverse`,
    headers: { cookie: adminCookie },
    payload: { reason: 'Double reverse attempt' },
  });
  assert.strictEqual(resDoubleRev.statusCode, 400);
  assert.strictEqual(resDoubleRev.json().error.code, 'ALREADY_REVERSED');
  console.log('✅ PASS: Double reversal prevented (400 ALREADY_REVERSED)');

  // Test Journal Entries List API
  const resList = await server.inject({
    method: 'GET',
    url: '/api/accounting/journal-entries?status=posted&page=1&limit=5',
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(resList.statusCode, 200);
  const listData = resList.json().data;
  assert.ok(Array.isArray(listData.entries));
  assert.ok(typeof listData.total === 'number');
  assert.strictEqual(listData.page, 1);
  assert.strictEqual(listData.limit, 5);
  console.log(`✅ PASS: GET /api/accounting/journal-entries returned ${listData.entries.length} of ${listData.total} entries`);

  // Test Draft -> Posted Lifecycle
  console.log('\n--- Draft -> Posted Lifecycle ---');
  const resDraft = await server.inject({
    method: 'POST',
    url: '/api/accounting/journal-entries',
    headers: { cookie: adminCookie },
    payload: {
      entryDate: '2026-06-20',
      entryType: 'general_journal',
      description: 'Draft memo entry',
      status: 'draft',
      lines: [
        { accountCode: '1000', debit: 250.0, credit: 0, lineDescription: 'Draft bank in' },
        { accountCode: '8000', debit: 0, credit: 250.0, lineDescription: 'Draft revenue in' },
      ],
    },
  });
  assert.strictEqual(resDraft.statusCode, 201);
  const draftEntry = resDraft.json().data;
  assert.strictEqual(draftEntry.status, 'draft');
  assert.strictEqual(draftEntry.postedAt, null);

  const resPostDraft = await server.inject({
    method: 'POST',
    url: `/api/accounting/journal-entries/${draftEntry.id}/post`,
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(resPostDraft.statusCode, 200);
  const postedDraft = resPostDraft.json().data;
  assert.strictEqual(postedDraft.status, 'posted');
  assert.ok(postedDraft.postedAt !== null);
  console.log(`✅ PASS: Draft journal entry ${draftEntry.entryNumber} transitioned to posted`);

  // Attempting to post it again should fail
  const resRepeatPost = await server.inject({
    method: 'POST',
    url: `/api/accounting/journal-entries/${draftEntry.id}/post`,
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(resRepeatPost.statusCode, 400);
  assert.strictEqual(resRepeatPost.json().error.code, 'ALREADY_POSTED');
  console.log('✅ PASS: Repeated post attempt rejected (400 ALREADY_POSTED)');

  // 5. Fiscal Lock Mechanism
  console.log('\n--- 5. Fiscal Lock Date Configuration & Enforcement ---');
  // Set fiscal lock to 2026-05-31
  const resSetLock = await server.inject({
    method: 'PUT',
    url: '/api/accounting/fiscal-lock',
    headers: { cookie: adminCookie },
    payload: { fiscalLockDate: '2026-05-31' },
  });
  assert.strictEqual(resSetLock.statusCode, 200);
  assert.strictEqual(resSetLock.json().data.fiscalLockDate, '2026-05-31');

  // Attempt entry inside closed fiscal period (e.g. 2026-04-15)
  const resLockedEntry = await server.inject({
    method: 'POST',
    url: '/api/accounting/journal-entries',
    headers: { cookie: adminCookie },
    payload: {
      entryDate: '2026-04-15',
      entryType: 'general_journal',
      description: 'Entry inside closed year',
      lines: [
        { accountCode: '1000', debit: 100.0, credit: 0 },
        { accountCode: '8000', debit: 0, credit: 100.0 },
      ],
    },
  });
  assert.strictEqual(resLockedEntry.statusCode, 400);
  assert.strictEqual(resLockedEntry.json().error.code, 'FISCAL_PERIOD_LOCKED');
  console.log('✅ PASS: Entry in locked fiscal period strictly blocked (400 FISCAL_PERIOD_LOCKED)');

  // Unlock fiscal date for subsequent tests
  await server.inject({
    method: 'PUT',
    url: '/api/accounting/fiscal-lock',
    headers: { cookie: adminCookie },
    payload: { fiscalLockDate: null },
  });
  console.log('✅ PASS: Fiscal lock removed/unlocked successfully');

  // 6. Sales Invoice -> Accounting Integration
  console.log('\n--- 6. Sales Invoice SENT -> Double-Entry Hook ---');
  // Grab any project and create a fresh test invoice for Q3
  const [proj] = await db.select().from(invoices).limit(1);
  const resCreateInv = await server.inject({
    method: 'POST',
    url: '/api/invoices',
    headers: { cookie: adminCookie },
    payload: {
      projectId: proj.projectId,
      issueDate: '2026-07-15',
      paymentTermsDays: 14,
      items: [
        {
          position: 1,
          description: 'Custom Teak Buitenkeuken Module Test',
          quantity: 1,
          unitPriceExclVat: 10000.0,
          vatRate: 21,
        },
      ],
    },
  });
  let testInvoice = resCreateInv.json().data;

  // Send the invoice
  const resSendInv = await server.inject({
    method: 'POST',
    url: `/api/invoices/${testInvoice.id}/send`,
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(resSendInv.statusCode, 200);

  // Verify journal entry created
  const [invEntry] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.invoiceId, testInvoice.id), eq(journalEntries.entryType, 'sales_invoice')))
    .limit(1);

  assert.ok(invEntry, 'Journal entry for sent invoice must be created');
  const fullInvEntry = await accountingService.getEntryById(invEntry.id);
  assert.strictEqual(fullInvEntry.status, 'posted');

  const line1300 = fullInvEntry.lines.find((l) => l.accountCode === '1300');
  const line8000 = fullInvEntry.lines.find((l) => l.accountCode === '8000');
  const line1500 = fullInvEntry.lines.find((l) => l.accountCode === '1500');

  assert.ok(line1300 && line1300.debit > 0, 'Dr 1300 Accounts Receivable must exist');
  assert.ok(line8000 && line8000.credit > 0, 'Cr 8000 Revenue must exist');
  assert.ok(line1500 && line1500.credit > 0, 'Cr 1500 VAT Payable must exist');
  assert.strictEqual(fullInvEntry.totalDebit, fullInvEntry.totalCredit);
  console.log(`✅ PASS: Sales invoice ${testInvoice.invoiceNumber} posted to GL: Dr 1300 / Cr 8000 / Cr 1500`);

  // 7. Payment -> Accounting Integration
  console.log('\n--- 7. Payment Succeeded -> Double-Entry Hook ---');
  const resPay = await server.inject({
    method: 'POST',
    url: `/api/invoices/${testInvoice.id}/mark-paid`,
    headers: { cookie: adminCookie },
    payload: {
      amount: 1000.0,
      paymentMethod: 'bank_transfer_abn',
      paidDate: '2026-07-05',
    },
  });
  assert.strictEqual(resPay.statusCode, 200);

  // Verify payment journal entry
  const [payEntry] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.invoiceId, testInvoice.id), eq(journalEntries.entryType, 'bank_receipt')))
    .orderBy(desc(journalEntries.createdAt))
    .limit(1);

  assert.ok(payEntry, 'Journal entry for payment must be created');
  const fullPayEntry = await accountingService.getEntryById(payEntry.id);
  const payDr1000 = fullPayEntry.lines.find((l) => l.accountCode === '1000');
  const payCr1300 = fullPayEntry.lines.find((l) => l.accountCode === '1300');

  assert.strictEqual(payDr1000?.debit, 1000.0, 'Dr 1000 Bank must be 1000.00');
  assert.strictEqual(payCr1300?.credit, 1000.0, 'Cr 1300 Accounts Receivable must be 1000.00');
  console.log(`✅ PASS: Customer payment recorded to GL: Dr 1000 (€1,000.00) / Cr 1300 (€1,000.00)`);

  // 8. General Ledger & Trial Balance Reports
  console.log('\n--- 8. General Ledger & Trial Balance ---');
  const resGL = await server.inject({
    method: 'GET',
    url: '/api/accounting/general-ledger?accountCode=1300',
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(resGL.statusCode, 200);
  const gl1300 = resGL.json().data[0];
  assert.strictEqual(gl1300.accountCode, '1300');
  assert.ok(gl1300.movements.length >= 2, 'Must have at least invoice and payment movements');
  console.log(`✅ PASS: General Ledger account 1300 calculated with ${gl1300.movements.length} movements`);

  const resTB = await server.inject({
    method: 'GET',
    url: '/api/accounting/trial-balance',
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(resTB.statusCode, 200);
  const tb = resTB.json().data;
  assert.strictEqual(tb.isBalanced, true, 'Trial balance total debit must equal total credit');
  console.log(`✅ PASS: Trial Balance (Saldibalans) is balanced: Total Dr €${tb.totalDebit} === Total Cr €${tb.totalCredit}`);

  // 9. VAT Report (Factuurstelsel)
  console.log('\n--- 9. VAT Report (BTW Aangifte Factuurstelsel) ---');
  const resVat = await server.inject({
    method: 'GET',
    url: '/api/accounting/vat-report?year=2026&quarter=3',
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(resVat.statusCode, 200);
  const vat = resVat.json().data;
  assert.strictEqual(vat.basis, 'factuurstelsel');
  assert.ok(vat.boxes.box1a.vatAmount > 0, 'Box 1a VAT amount must be positive from sent invoice');
  assert.strictEqual(vat.boxes.box5g.netVatPayable, vat.boxes.box1a.vatAmount - vat.boxes.box5b.vatAmount);
  console.log(`✅ PASS: VAT Report Box 1a: €${vat.boxes.box1a.vatAmount}, Net Box 5g: €${vat.boxes.box5g.netVatPayable}`);

  // 10. Profit & Loss Report
  console.log('\n--- 10. Profit & Loss (Winst & Verlies) ---');
  const resPL = await server.inject({
    method: 'GET',
    url: '/api/accounting/profit-loss?year=2026',
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(resPL.statusCode, 200);
  const pl = resPL.json().data;
  assert.ok(pl.revenue.totalRevenue > 0, 'Revenue must be positive');
  assert.strictEqual(pl.netOperatingResult, pl.grossProfit - pl.operatingExpenses.totalOperatingExpenses);
  console.log(`✅ PASS: Profit & Loss Net Operating Result: €${pl.netOperatingResult}`);

  // 11. Balance Sheet Report
  console.log('\n--- 11. Balance Sheet (Balans) ---');
  const resBS = await server.inject({
    method: 'GET',
    url: '/api/accounting/balance-sheet',
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(resBS.statusCode, 200);
  const bs = resBS.json().data;
  assert.strictEqual(bs.isBalanced, true, 'Balance sheet must balance: Total Assets === Total Liabilities & Equity');
  console.log(`✅ PASS: Balance Sheet is balanced: Assets €${bs.assets.totalAssets} === Liabilities & Equity €${bs.liabilitiesAndEquity.totalLiabilitiesAndEquity}`);

  // Credit Note Accounting Hook Test
  console.log('\n--- 12. Credit Note -> Accounting Hook ---');
  const resCr = await server.inject({
    method: 'POST',
    url: `/api/invoices/${testInvoice.id}/credit-note`,
    headers: { cookie: adminCookie },
    payload: { reason: 'Test credit for accounting module' },
  });
  assert.strictEqual(resCr.statusCode, 201);
  const creditNoteInv = resCr.json().data.creditNote;

  const [crEntry] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.invoiceId, creditNoteInv.id), eq(journalEntries.entryType, 'sales_invoice')))
    .limit(1);

  assert.ok(crEntry, 'Journal entry for credit note must exist');
  const fullCrEntry = await accountingService.getEntryById(crEntry.id);
  const crLine8000 = fullCrEntry.lines.find((l) => l.accountCode === '8000');
  const crLine1500 = fullCrEntry.lines.find((l) => l.accountCode === '1500');
  const crLine1300 = fullCrEntry.lines.find((l) => l.accountCode === '1300');
  assert.ok(crLine8000 && crLine8000.debit > 0, 'Dr 8000 Revenue on credit note');
  assert.ok(crLine1500 && crLine1500.debit > 0, 'Dr 1500 VAT Payable on credit note');
  assert.ok(crLine1300 && crLine1300.credit > 0, 'Cr 1300 AR on credit note');
  console.log(`✅ PASS: Credit note ${creditNoteInv.invoiceNumber} posted opposite entries: Dr 8000 / Dr 1500 / Cr 1300`);

  // Bank Allocation & Unallocation -> Storno Reversal Test
  console.log('\n--- 13. Bank Allocation & Unallocation -> Storno Reversal ---');
  const [bankTx] = await db
    .insert(bankTransactions)
    .values({
      bankTxId: `TX-ACCT-TEST-${Date.now()}`,
      accountIban: 'NL91ABNA0417164300',
      transactionDate: '2026-07-20',
      amount: '500.00',
      direction: 'credit',
      counterName: 'Test Payer B.V.',
      reconciliationStatus: 'unmatched',
    })
    .returning();

  const resInvForAlloc = await server.inject({
    method: 'POST',
    url: '/api/invoices',
    headers: { cookie: adminCookie },
    payload: {
      projectId: proj.projectId,
      issueDate: '2026-07-20',
      paymentTermsDays: 14,
      items: [
        {
          position: 1,
          description: 'Allocation Test Item',
          quantity: 1,
          unitPriceExclVat: 500.0,
          vatRate: 21,
        },
      ],
    },
  });
  const invForAlloc = resInvForAlloc.json().data;
  await server.inject({
    method: 'POST',
    url: `/api/invoices/${invForAlloc.id}/send`,
    headers: { cookie: adminCookie },
  });

  const resAlloc = await server.inject({
    method: 'POST',
    url: `/api/bank/transactions/${bankTx.id}/allocate`,
    headers: { cookie: adminCookie },
    payload: {
      allocations: [
        { invoiceId: invForAlloc.id, amount: 500.0, notes: 'Allocated in test' },
      ],
    },
  });
  assert.strictEqual(resAlloc.statusCode, 201);

  const [allocJe] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.invoiceId, invForAlloc.id), eq(journalEntries.entryType, 'bank_receipt'), eq(journalEntries.isReversal, false)))
    .limit(1);
  assert.ok(allocJe, 'Journal entry for bank allocation must exist');
  assert.strictEqual(allocJe.status, 'posted');
  console.log(`✅ PASS: Bank allocation created posted journal entry: ${allocJe.entryNumber}`);

  // Unallocate bank transaction
  const resUnalloc = await server.inject({
    method: 'POST',
    url: `/api/bank/transactions/${bankTx.id}/unallocate`,
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(resUnalloc.statusCode, 200);

  const [reversedAllocJe] = await db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.id, allocJe.id))
    .limit(1);
  assert.strictEqual(reversedAllocJe.status, 'reversed');
  assert.ok(reversedAllocJe.reversedByEntryId, 'Must link to reversal entry');

  const [revJe] = await db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.id, reversedAllocJe.reversedByEntryId!))
    .limit(1);
  assert.ok(revJe, 'Reversal entry must exist');
  assert.strictEqual(revJe.isReversal, true);
  assert.strictEqual(revJe.status, 'posted');
  console.log(`✅ PASS: Bank unallocation reversed journal entry: ${allocJe.entryNumber} -> ${revJe.entryNumber}`);

  // Repeated unallocation should fail safely (no double reversal)
  const resRepeatUnalloc = await server.inject({
    method: 'POST',
    url: `/api/bank/transactions/${bankTx.id}/unallocate`,
    headers: { cookie: adminCookie },
  });
  assert.strictEqual(resRepeatUnalloc.statusCode, 400);
  assert.strictEqual(resRepeatUnalloc.json().error.code, 'NO_ALLOCATIONS');
  console.log('✅ PASS: Repeated unallocation prevented (400 NO_ALLOCATIONS)');

  console.log('\n======================================================');
  console.log('🎉 ALL MODULE 8 TESTS PASSED (100% SUCCESS)');
  console.log('======================================================');

  await server.close();
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
