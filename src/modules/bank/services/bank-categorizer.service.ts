import type { ParsedBankTransaction } from '../bank.types.js';

export const COMPANY_SAVINGS_IBAN = 'NL44ABNA0987654321';

export interface CategorizationResult {
  category: string;
  matchReason: string;
  reconciliationStatus: 'unmatched' | 'matched_invoice' | 'matched_expense' | 'manual_reconciled';
  reviewReason: string | null;
  isInternalTransfer: boolean;
  hasBolSpec?: boolean;
}

export function categorizeBankTransaction(tx: {
  counterName?: string | null;
  counterIban?: string | null;
  description?: string | null;
  remittanceInfo?: string | null;
  amount: number;
  direction: 'credit' | 'debit';
}): CategorizationResult {
  const counterName = (tx.counterName || '').trim();
  const counterIban = (tx.counterIban || '').replace(/\s+/g, '');
  const description = (tx.description || tx.remittanceInfo || '').trim();
  const fullText = `${counterName} ${counterIban} ${description}`.toLowerCase();

  const creditVal = tx.direction === 'credit' ? Number(tx.amount || 0) : 0;
  const debitVal = tx.direction === 'debit' ? Number(tx.amount || 0) : 0;

  // RULE 1: Internal Transfers (Zakelijk Flexibel Sparen / Company Savings / €0.10 Verification)
  if (
    counterIban === COMPANY_SAVINGS_IBAN ||
    fullText.includes('zakelijk flexibel sparen') ||
    fullText.includes('interne overboeking') ||
    (counterName.toUpperCase().includes('VANUIT AMBACHT') &&
      (fullText.includes('sparen') || fullText.includes('interne'))) ||
    ((debitVal === 0.1 || creditVal === 0.1) &&
      (fullText.includes('verificatie') || fullText.includes('1 cent') || fullText.includes('0.10')))
  ) {
    return {
      category: 'Internal Transfer / Kruispost',
      matchReason: 'Savings IBAN Match — Internal Transfer',
      reconciliationStatus: 'matched_expense',
      reviewReason: null,
      isInternalTransfer: true,
    };
  }

  // RULE 1.5: Private / Director Withdrawal
  if (
    fullText.includes('privé opname') ||
    fullText.includes('prive opname') ||
    fullText.includes('priveontrekking') ||
    fullText.includes('geldopname prive')
  ) {
    return {
      category: 'Private Withdrawal',
      matchReason: 'Private Withdrawal Match',
      reconciliationStatus: 'matched_expense',
      reviewReason: null,
      isInternalTransfer: false,
    };
  }

  // RULE 2: Smart Fulfilment B.V. -> Transport – Smart Fulfilment (NEVER Purchasing)
  if (fullText.includes('smart fulfilment')) {
    return {
      category: 'Transport – Smart Fulfilment',
      matchReason: 'Description Match — Smart Fulfilment',
      reconciliationStatus: 'matched_expense',
      reviewReason: null,
      isInternalTransfer: false,
    };
  }

  // RULE 3: Ruben Verbeij Meubels Op Maat -> Purchasing (Inkoop)
  if (
    fullText.includes('ruben verbeij') ||
    fullText.includes('meubels op maat') ||
    fullText.includes('hoek bouw') ||
    fullText.includes('sven hoek')
  ) {
    return {
      category: 'Purchasing (Inkoop)',
      matchReason: 'IBAN Match — Ruben Verbeij',
      reconciliationStatus: 'matched_expense',
      reviewReason: null,
      isInternalTransfer: false,
    };
  }

  // RULE 4: Houtslagers -> Purchasing (Inkoop)
  if (fullText.includes('houtslagers')) {
    return {
      category: 'Purchasing (Inkoop)',
      matchReason: 'IBAN Match — Houtslagers',
      reconciliationStatus: 'matched_expense',
      reviewReason: null,
      isInternalTransfer: false,
    };
  }

  // RULE 5: Alibaba.com Singapore -> Purchasing (Inkoop)
  if (fullText.includes('alibaba') || fullText.includes('alibaba.com')) {
    return {
      category: 'Purchasing (Inkoop)',
      matchReason: 'Counterparty Match — Alibaba.com Singapore',
      reconciliationStatus: 'matched_expense',
      reviewReason: null,
      isInternalTransfer: false,
    };
  }

  // RULE 6: bol.com -> Revenue – bol.com
  if (fullText.includes('bolcom') || fullText.includes('bol.com')) {
    return {
      category: 'Revenue – bol.com',
      matchReason: 'bol.com Seller Account Payout Match',
      reconciliationStatus: 'matched_expense',
      hasBolSpec: true,
      reviewReason: null,
      isInternalTransfer: false,
    };
  }

  // RULE 7: Meta Advertising -> Advertising – Meta Ads
  if (
    fullText.includes('meta ads') ||
    fullText.includes('meta platforms') ||
    fullText.includes('facebook ads') ||
    fullText.includes('instagram ads')
  ) {
    return {
      category: 'Advertising – Meta Ads',
      matchReason: 'Creditor ID Match — Meta Ads',
      reconciliationStatus: 'matched_expense',
      reviewReason: null,
      isInternalTransfer: false,
    };
  }

  // PayPal WITH Meta reference -> Advertising – Meta Ads
  // PayPal WITHOUT Meta reference -> Payment Provider Fees
  if (fullText.includes('paypal')) {
    if (fullText.includes('meta') || fullText.includes('facebook') || fullText.includes('ads')) {
      return {
        category: 'Advertising – Meta Ads',
        matchReason: 'Creditor ID Match — PayPal / Meta Ads',
        reconciliationStatus: 'matched_expense',
        reviewReason: null,
        isInternalTransfer: false,
      };
    }
    return {
      category: 'Payment Provider Fees',
      matchReason: 'Payment Provider Match — PayPal Fees',
      reconciliationStatus: 'matched_expense',
      reviewReason: null,
      isInternalTransfer: false,
    };
  }

  // RULE 8: Known Software Counterparties
  if (
    fullText.includes('google cloud') ||
    fullText.includes('transip') ||
    fullText.includes('e-boekhouden') ||
    fullText.includes('skillsource') ||
    fullText.includes('dubline') ||
    fullText.includes('wordpress') ||
    fullText.includes('canva') ||
    fullText.includes('jetpack')
  ) {
    return {
      category: 'Software',
      matchReason: 'Software Supplier Match',
      reconciliationStatus: 'matched_expense',
      reviewReason: null,
      isInternalTransfer: false,
    };
  }

  // Known other counterparties
  if (fullText.includes('gs1') || fullText.includes('gs1 nederland')) {
    return {
      category: 'Software',
      matchReason: 'Barcode & Identifier Fee Match (GS1)',
      reconciliationStatus: 'matched_expense',
      reviewReason: null,
      isInternalTransfer: false,
    };
  }
  if (fullText.includes('buckaroo')) {
    return {
      category: 'Payment Provider Fees',
      matchReason: 'Payment Provider Match — Buckaroo',
      reconciliationStatus: 'matched_expense',
      reviewReason: null,
      isInternalTransfer: false,
    };
  }
  if (fullText.includes('postnl') || fullText.includes('dhl')) {
    return {
      category: 'Shipping Costs',
      matchReason: 'Shipping Carrier Match — PostNL/DHL',
      reconciliationStatus: 'matched_expense',
      reviewReason: null,
      isInternalTransfer: false,
    };
  }
  if (
    fullText.includes('abn amro bank') ||
    fullText.includes('bankkosten') ||
    fullText.includes('correspondent fee')
  ) {
    return {
      category: 'Bank Charges',
      matchReason: 'Bank Fee Match — ABN AMRO',
      reconciliationStatus: 'matched_expense',
      reviewReason: null,
      isInternalTransfer: false,
    };
  }
  if (fullText.includes('belastingdienst')) {
    return {
      category: 'VAT Settlement',
      matchReason: 'Tax Authority Match — Belastingdienst',
      reconciliationStatus: 'matched_expense',
      reviewReason: null,
      isInternalTransfer: false,
    };
  }
  if (fullText.includes('int card services') || fullText.includes('ics card')) {
    return {
      category: 'Credit Card Suspense',
      matchReason: 'Credit Card Suspense Match — ICS',
      reconciliationStatus: 'matched_expense',
      reviewReason: null,
      isInternalTransfer: false,
    };
  }
  if (fullText.includes('coolblue') || fullText.includes('staples')) {
    return {
      category: 'Office Supplies',
      matchReason: 'Office Supplies Match',
      reconciliationStatus: 'matched_expense',
      reviewReason: null,
      isInternalTransfer: false,
    };
  }
  if (
    fullText.includes('beef.steak') ||
    fullText.includes('luxury meat') ||
    fullText.includes('relatiegeschenk')
  ) {
    return {
      category: 'Customer Gifts',
      matchReason: 'Customer Gifts Match',
      reconciliationStatus: 'matched_expense',
      reviewReason: null,
      isInternalTransfer: false,
    };
  }
  if (fullText.includes('restaurant') || fullText.includes('q-park') || fullText.includes('hotel')) {
    return {
      category: 'Travel / Entertainment',
      matchReason: 'Travel & Hospitality Match',
      reconciliationStatus: 'matched_expense',
      reviewReason: null,
      isInternalTransfer: false,
    };
  }

  // RULE 10: Customer Payment Patterns -> Revenue – Outdoor Kitchens
  const customerPaymentPatterns = [
    { regex: /FA-2026-?\d{3}/i, reason: 'Invoice Pattern Match — Customer Payment (FA-2026)' },
    { regex: /OF-2026-?\d{3}/i, reason: 'Invoice Pattern Match — Customer Payment (OF-2026)' },
    { regex: /INV-?\d{4}/i, reason: 'Invoice Pattern Match — Customer Payment (INV)' },
    { regex: /Q-?\d{4}/i, reason: 'Invoice Pattern Match — Customer Payment (Q)' },
    { regex: /2025-?\d{3}/i, reason: 'Invoice Pattern Match — Customer Payment (2025)' },
    { regex: /aan\s*betaling/i, reason: 'Invoice Pattern Match — Customer Payment (Aanbetaling)' },
    { regex: /slot\s*betaling/i, reason: 'Invoice Pattern Match — Customer Payment (Slotbetaling)' },
    { regex: /slot\s*factuur/i, reason: 'Invoice Pattern Match — Customer Payment (Slotfactuur)' },
    { regex: /50\s*%/i, reason: 'Invoice Pattern Match — Customer Payment (50%)' },
    { regex: /90\s*%/i, reason: 'Invoice Pattern Match — Customer Payment (90%)' },
    { regex: /50\s*procent/i, reason: 'Invoice Pattern Match — Customer Payment (50%)' },
  ];

  for (const pat of customerPaymentPatterns) {
    if (pat.regex.test(description) || pat.regex.test(counterName)) {
      return {
        category: 'Revenue – Outdoor Kitchens',
        matchReason: pat.reason,
        reconciliationStatus: 'unmatched', // Needs matching to specific invoice
        reviewReason: null,
        isInternalTransfer: false,
      };
    }
  }

  // Check incoming credit from person name
  if (creditVal > 0 && counterName && counterName !== 'Onbekend') {
    const nameLower = counterName.toLowerCase();
    if (
      !nameLower.includes('bv') &&
      !nameLower.includes('b.v.') &&
      !nameLower.includes('ltd') &&
      !nameLower.includes('inc') &&
      !nameLower.includes('gmbh')
    ) {
      return {
        category: 'Revenue – Outdoor Kitchens',
        matchReason: `Invoice Pattern Match — Customer Payment (${counterName})`,
        reconciliationStatus: 'unmatched',
        reviewReason: null,
        isInternalTransfer: false,
      };
    }
  }

  // RULE 11: UNKNOWN / UNMATCHED TRANSACTIONS -> Review Item / Vraagpost
  let reviewReason = `No configured counterparty or invoice matching rule found for "${counterName || 'Unknown'}".`;

  if (
    !counterName ||
    counterName.toLowerCase() === 'onbekend' ||
    counterName.toLowerCase().includes('assf') ||
    counterName.toLowerCase().includes('qwer')
  ) {
    reviewReason = 'No recognizable counterparty, IBAN or business reference found.';
  } else if (
    fullText.includes('teak wood') ||
    fullText.includes('granite') ||
    fullText.includes('craftwood') ||
    fullText.includes('erik van den berg')
  ) {
    reviewReason = 'No invoice/reference found. Project matching required.';
  } else if (creditVal > 0 && counterName && !description.match(/FA-2026|OF-2026|INV-|Q-/i)) {
    reviewReason = `Customer/payment pattern found for "${counterName}", but no confident order match.`;
  }

  return {
    category: 'Review Item / Vraagpost',
    matchReason: 'No Matching Rule — Review Required',
    reconciliationStatus: 'unmatched',
    reviewReason,
    isInternalTransfer: false,
  };
}
