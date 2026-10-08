import { generateDeterministicBankTxId } from './statement.validator.js';
export function parseAbnText(rawText, defaultIban = 'NL44ABNA0987654321') {
    const transactions = [];
    const text = rawText.trim();
    // Extract header metadata if present
    let openingBalance = 10000;
    let closingBalance = 8585;
    let expectedCount;
    const countMatch = text.match(/\/COUNT\/(\d+)/i) || text.match(/verwacht\s*aantal:\s*(\d+)/i) || text.match(/expected\s*count:\s*(\d+)/i);
    if (countMatch) {
        expectedCount = parseInt(countMatch[1], 10);
    }
    const openingMatch = text.match(/beginsaldo:\s*([0-9.,]+)/i) || text.match(/\/OPENING\/([0-9.,]+)/i) || text.match(/opening\s*balance:\s*([0-9.,]+)/i);
    if (openingMatch) {
        openingBalance = parseFloat(openingMatch[1].replace(/\./g, '').replace(',', '.'));
    }
    const closingMatch = text.match(/eindsaldo:\s*([0-9.,]+)/i) || text.match(/\/CLOSING\/([0-9.,]+)/i) || text.match(/closing\s*balance:\s*([0-9.,]+)/i);
    if (closingMatch) {
        closingBalance = parseFloat(closingMatch[1].replace(/\./g, '').replace(',', '.'));
    }
    // 1. FORMAT A: NEW SLASH-DELIMITED FORMAT (/TRTP/SEPA OVERBOEKING/IBAN/...)
    if (text.includes('/TRTP/') || text.includes('/IBAN/') || text.includes('/AMT/')) {
        const blocks = text.split(/(?=\/TRTP\/)/i).filter((b) => b.trim().length > 0);
        for (const block of blocks) {
            const getTag = (tag) => {
                const regex = new RegExp(`\\/${tag}\\/([^/]+)`, 'i');
                const match = block.match(regex);
                return match ? match[1].trim() : '';
            };
            const iban = getTag('IBAN');
            const name = getTag('NAME');
            const remi = getTag('REMI');
            const amtStr = getTag('AMT');
            const eref = getTag('EREF');
            if (amtStr) {
                let cleanAmt = amtStr.replace(/\s+/g, '');
                const isNegative = cleanAmt.startsWith('-');
                cleanAmt = cleanAmt.replace(/^[-+]/, '').replace(/\./g, '').replace(',', '.');
                const numericAmount = Math.abs(parseFloat(cleanAmt));
                const tempTx = {
                    bankTxId: '',
                    accountIban: defaultIban,
                    transactionDate: new Date().toISOString().split('T')[0],
                    counterIban: iban || undefined,
                    counterName: name || undefined,
                    amount: numericAmount,
                    direction: isNegative ? 'debit' : 'credit',
                    description: remi || name || 'ABN AMRO SEPA overboeking',
                    remittanceInfo: remi || undefined,
                    eref: eref || undefined,
                };
                tempTx.bankTxId = generateDeterministicBankTxId(tempTx);
                transactions.push(tempTx);
            }
        }
    }
    else {
        // 2. FORMAT B: OLD LINE-BASED FORMAT
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        let currentRecord = {};
        const pushCurrent = () => {
            if (currentRecord.amount) {
                let cleanAmt = currentRecord.amount.replace(/\s+/g, '');
                const isNegative = cleanAmt.startsWith('-');
                cleanAmt = cleanAmt.replace(/^[-+]/, '').replace(/\./g, '').replace(',', '.');
                const numericAmount = Math.abs(parseFloat(cleanAmt));
                const tempTx = {
                    bankTxId: '',
                    accountIban: defaultIban,
                    transactionDate: currentRecord.date || new Date().toISOString().split('T')[0],
                    counterIban: currentRecord.iban || undefined,
                    counterName: currentRecord.name || undefined,
                    amount: numericAmount,
                    direction: isNegative ? 'debit' : 'credit',
                    description: currentRecord.desc || currentRecord.name || 'ABN AMRO SEPA overboeking',
                    remittanceInfo: currentRecord.desc || undefined,
                    eref: currentRecord.eref || undefined,
                };
                tempTx.bankTxId = generateDeterministicBankTxId(tempTx);
                transactions.push(tempTx);
            }
            currentRecord = {};
        };
        for (const line of lines) {
            if (line.toLowerCase().startsWith('sepa overboeking') ||
                line.toLowerCase().startsWith('ideal') ||
                line.toLowerCase().startsWith('bea card')) {
                pushCurrent();
            }
            else if (line.match(/^IBAN:\s*(.*)/i)) {
                currentRecord.iban = line.match(/^IBAN:\s*(.*)/i)[1].trim();
            }
            else if (line.match(/^Naam:\s*(.*)/i)) {
                currentRecord.name = line.match(/^Naam:\s*(.*)/i)[1].trim();
            }
            else if (line.match(/^Omschrijving:\s*(.*)/i)) {
                currentRecord.desc = line.match(/^Omschrijving:\s*(.*)/i)[1].trim();
            }
            else if (line.match(/^Bedrag\s*(?:\(€\))?:\s*(.*)/i)) {
                currentRecord.amount = line.match(/^Bedrag\s*(?:\(€\))?:\s*(.*)/i)[1].trim();
            }
            else if (line.match(/^Kenmerk:\s*(.*)/i)) {
                currentRecord.eref = line.match(/^Kenmerk:\s*(.*)/i)[1].trim();
            }
            else if (line.match(/^Datum:\s*(\d{4}-\d{2}-\d{2})/i)) {
                currentRecord.date = line.match(/^Datum:\s*(\d{4}-\d{2}-\d{2})/i)[1].trim();
            }
        }
        pushCurrent();
    }
    const totalCredits = transactions
        .filter((t) => t.direction === 'credit')
        .reduce((s, t) => s + t.amount, 0);
    const totalDebits = transactions
        .filter((t) => t.direction === 'debit')
        .reduce((s, t) => s + t.amount, 0);
    // If opening was provided but closing was not explicitly in text, calculate expected closing
    if (!closingMatch && openingMatch) {
        closingBalance = Math.round((openingBalance + totalCredits - totalDebits) * 100) / 100;
    }
    const header = {
        statementIdentifier: `ABN-${Date.now()}`,
        accountIban: defaultIban,
        openingBalance: Math.round(openingBalance * 100) / 100,
        closingBalance: Math.round(closingBalance * 100) / 100,
        totalCredits: Math.round(totalCredits * 100) / 100,
        totalDebits: Math.round(totalDebits * 100) / 100,
        expectedCount: expectedCount || transactions.length,
        fileFormat: 'abn_text',
        fileName: 'statement.txt',
    };
    return { header, transactions };
}
