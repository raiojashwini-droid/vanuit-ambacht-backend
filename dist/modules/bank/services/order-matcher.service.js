import { db } from '../../../db/index.js';
import { invoices, customers, payments } from '../../../db/schema.js';
import { eq, and, ne, inArray } from 'drizzle-orm';
export function normalizePayerName(nameStr) {
    if (!nameStr)
        return [];
    const clean = nameStr
        .replace(/\b(hr|mw|dhr|mvr|ing|dr|ir)\b/gi, '')
        .replace(/\b(e\/o|eo|and|en|\&)\b/gi, '|')
        .replace(/\b(b\.?v\.?|ltd\.?|n\.?v\.?|gmbh)\b/gi, '')
        .trim();
    return clean
        .split('|')
        .map((part) => part.replace(/[^a-zA-Z0-9\s]/g, '').trim())
        .filter((part) => part.length > 2);
}
export function extractInvoiceOrQuoteNumber(text) {
    if (!text)
        return null;
    const str = text.replace(/\s+/g, '');
    const matchINV = str.match(/INV-?2026-?\d{3,4}/i);
    if (matchINV)
        return matchINV[0].toUpperCase().replace(/(\w{3})-?(\d{4})-?(\d{3,4})/, '$1-$2-$3');
    const matchFA = str.match(/FA-?2026-?\d{3}/i);
    if (matchFA)
        return matchFA[0].toUpperCase().replace(/(\w{2})(\d{4})(\d{3})/, '$1-$2-$3');
    const matchOF = str.match(/OF-?2026-?\d{3}/i);
    if (matchOF)
        return matchOF[0].toUpperCase().replace(/(\w{2})(\d{4})(\d{3})/, '$1-$2-$3');
    const match2025 = str.match(/2025-?\d{3}/i);
    if (match2025)
        return match2025[0].toUpperCase();
    const matchQ = str.match(/Q-?\d{4}/i);
    if (matchQ)
        return matchQ[0].toUpperCase();
    return null;
}
export class OrderMatcherService {
    /**
     * Matches an incoming credit transaction against open invoices in the database
     */
    async matchCreditTransaction(tx, client = db) {
        const description = `${tx.description || ''} ${tx.remittanceInfo || ''} ${tx.eref || ''}`;
        const counterName = tx.counterName || '';
        const creditAmount = Number(tx.amount || 0);
        if (creditAmount <= 0) {
            return {
                isMatched: false,
                tier: 4,
                confidence: 0,
                reviewReason: 'Not a credit transaction',
            };
        }
        // TIER 1: EXACT INVOICE / QUOTE REFERENCE MATCH
        const extractedRef = extractInvoiceOrQuoteNumber(description) || extractInvoiceOrQuoteNumber(counterName);
        if (extractedRef) {
            // Look up open/sent/partially_paid invoice with matching invoice number
            const [matchedInv] = await client
                .select({
                invoice: invoices,
                customerFirstName: customers.firstName,
                customerLastName: customers.lastName,
                customerCompanyName: customers.companyName,
            })
                .from(invoices)
                .leftJoin(customers, eq(invoices.customerId, customers.id))
                .where(and(eq(invoices.invoiceNumber, extractedRef), ne(invoices.status, 'credited')))
                .limit(1);
            if (matchedInv) {
                const custName = matchedInv.customerCompanyName
                    ? `${matchedInv.customerCompanyName} (${matchedInv.customerFirstName} ${matchedInv.customerLastName})`
                    : `${matchedInv.customerFirstName} ${matchedInv.customerLastName}`;
                return {
                    isMatched: true,
                    matchingMethod: 'Automatic (Invoice Ref)',
                    tier: 1,
                    invoiceId: matchedInv.invoice.id,
                    invoiceNumber: matchedInv.invoice.invoiceNumber,
                    customerId: matchedInv.invoice.customerId,
                    customerName: custName.trim(),
                    confidence: 1.0,
                    matchReason: `Exact Reference Match — Invoice ${matchedInv.invoice.invoiceNumber}`,
                };
            }
        }
        // TIER 2: CONTROLLED MATCHING VIA NORMALIZED NAME + EXPECTED AMOUNT
        const payerTokens = normalizePayerName(counterName);
        if (payerTokens.length === 0) {
            return {
                isMatched: false,
                tier: 4,
                confidence: 0,
                reviewReason: `Onbekende betaler "${counterName || 'Unknown'}" zonder match op factuurkenmerk.`,
            };
        }
        // Fetch open invoices (sent or partially_paid)
        const candidateRows = await client
            .select({
            invoice: invoices,
            customerFirstName: customers.firstName,
            customerLastName: customers.lastName,
            customerCompanyName: customers.companyName,
        })
            .from(invoices)
            .leftJoin(customers, eq(invoices.customerId, customers.id))
            .where(inArray(invoices.status, ['sent', 'partially_paid', 'overdue']));
        const candidateMatches = [];
        for (const row of candidateRows) {
            const custFull = `${row.customerFirstName || ''} ${row.customerLastName || ''} ${row.customerCompanyName || ''}`.trim();
            const custTokens = normalizePayerName(custFull);
            const hasNameMatch = payerTokens.some((pt) => custTokens.some((ct) => ct.toLowerCase().includes(pt.toLowerCase()) ||
                pt.toLowerCase().includes(ct.toLowerCase())));
            if (!hasNameMatch)
                continue;
            // Compute current outstanding balance for this candidate invoice
            const invPayments = await client
                .select()
                .from(payments)
                .where(and(eq(payments.invoiceId, row.invoice.id), eq(payments.status, 'succeeded')));
            const paidSum = invPayments.reduce((acc, p) => acc + parseFloat(p.amount || '0'), 0);
            const totalVal = parseFloat(row.invoice.totalInclVat || '0');
            const outstandingVal = Math.max(0, totalVal - paidSum);
            const matches100 = Math.abs(creditAmount - totalVal) <= 0.5;
            const matchesOutstanding = Math.abs(creditAmount - outstandingVal) <= 0.5;
            const matches50 = Math.abs(creditAmount - totalVal * 0.5) <= 0.5;
            const matches10 = Math.abs(creditAmount - totalVal * 0.1) <= 0.5;
            const matches90 = Math.abs(creditAmount - totalVal * 0.9) <= 0.5;
            if (matches100 || matchesOutstanding || matches50 || matches10 || matches90) {
                let matchLabel = 'Outstanding Balance';
                if (matches100)
                    matchLabel = '100% Total Value';
                else if (matches50)
                    matchLabel = '50% Down Payment';
                else if (matches10)
                    matchLabel = '10% Deposit';
                else if (matches90)
                    matchLabel = '90% Final Completion';
                candidateMatches.push({
                    invoice: row.invoice,
                    customerName: custFull,
                    confidence: 0.9,
                    reason: `Controlled Name + Amount Match (${matchLabel}) — ${row.invoice.invoiceNumber}`,
                });
            }
        }
        if (candidateMatches.length === 1) {
            const match = candidateMatches[0];
            return {
                isMatched: true,
                matchingMethod: 'Automatic (Name + Amount Fallback)',
                tier: 2,
                invoiceId: match.invoice.id,
                invoiceNumber: match.invoice.invoiceNumber,
                customerId: match.invoice.customerId,
                customerName: match.customerName,
                confidence: match.confidence,
                matchReason: match.reason,
            };
        }
        // TIER 3: AMBIGUOUS (>1 candidates)
        if (candidateMatches.length > 1) {
            return {
                isMatched: false,
                tier: 3,
                confidence: 0.5,
                reviewReason: `Meerdere kandidaten (${candidateMatches.length}) gevonden voor "${counterName}" (€ ${creditAmount.toFixed(2)}). Handmatige toewijzing vereist.`,
            };
        }
        // TIER 4: UNKNOWN
        return {
            isMatched: false,
            tier: 4,
            confidence: 0,
            reviewReason: `Klant/betaler "${counterName}" gevonden, maar geen overeenkomend bedrag op openstaande facturen.`,
        };
    }
}
export const orderMatcherService = new OrderMatcherService();
