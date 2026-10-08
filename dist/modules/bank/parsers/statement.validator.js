import crypto from 'node:crypto';
export function calculateContentHash(content) {
    return crypto.createHash('sha256').update(content.trim()).digest('hex');
}
export function generateDeterministicBankTxId(tx) {
    if (tx.eref && tx.eref.trim().length > 3) {
        return `TX-${tx.eref.trim().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    }
    const payload = [
        tx.transactionDate,
        tx.amount.toFixed(2),
        tx.direction,
        tx.accountIban.replace(/\s+/g, ''),
        (tx.counterIban || '').replace(/\s+/g, ''),
        (tx.counterName || '').trim().toLowerCase(),
        (tx.description || '').trim().toLowerCase().slice(0, 50),
    ].join('|');
    const hash = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
    return `TX-${tx.transactionDate.replace(/-/g, '')}-${hash}`;
}
export function validateStatementIntegrity(header, transactions) {
    const errors = [];
    const opening = Math.round(Number(header.openingBalance || 0) * 100) / 100;
    const closing = Math.round(Number(header.closingBalance || 0) * 100) / 100;
    const totalCredits = Math.round(transactions
        .filter((t) => t.direction === 'credit')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0) * 100) / 100;
    const totalDebits = Math.round(transactions
        .filter((t) => t.direction === 'debit')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0) * 100) / 100;
    const calculatedClosing = Math.round((opening + totalCredits - totalDebits) * 100) / 100;
    const discrepancy = Math.round(Math.abs(calculatedClosing - closing) * 100) / 100;
    // Requirement: Allow maximum difference of €0.01
    const isBalanceValid = discrepancy <= 0.01;
    if (!isBalanceValid) {
        errors.push(`Statement checksum discrepancy of €${discrepancy.toFixed(2)}: ` +
            `Opening (€${opening.toFixed(2)}) + Credits (€${totalCredits.toFixed(2)}) - Debits (€${totalDebits.toFixed(2)}) ` +
            `= Calculated €${calculatedClosing.toFixed(2)}, but Statement header closing is €${closing.toFixed(2)}`);
    }
    if (header.expectedCount !== undefined && header.expectedCount > 0) {
        if (transactions.length !== header.expectedCount) {
            errors.push(`Transaction count mismatch: Header expects ${header.expectedCount} transactions, but parsed ${transactions.length}`);
        }
    }
    if (transactions.length === 0) {
        errors.push('Statement contains zero valid transactions');
    }
    return {
        isValid: errors.length === 0,
        openingBalance: opening,
        closingBalance: closing,
        calculatedClosingBalance: calculatedClosing,
        totalCredits,
        totalDebits,
        discrepancy,
        transactionCount: transactions.length,
        expectedCount: header.expectedCount,
        errors,
    };
}
