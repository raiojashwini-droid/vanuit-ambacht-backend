import { generateDeterministicBankTxId } from './statement.validator.js';
export function parseMt940(rawText, defaultIban = 'NL44ABNA0987654321') {
    const lines = rawText.split(/\r?\n/);
    let statementIdentifier = 'MT940-STMT';
    let accountIban = defaultIban;
    let openingBalance = 0;
    let closingBalance = 0;
    let openingFound = false;
    let closingFound = false;
    const rawTxList = [];
    let currentTx = null;
    let currentTag = '';
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // SWIFT tags start with :XX: or :XXX:
        const tagMatch = line.match(/^:([0-9]{2}[A-Z]?):(.*)$/);
        if (tagMatch) {
            currentTag = tagMatch[1];
            const tagContent = tagMatch[2].trim();
            if (currentTag === '20') {
                statementIdentifier = tagContent || statementIdentifier;
            }
            else if (currentTag === '25') {
                accountIban = tagContent.replace(/\s+/g, '') || accountIban;
            }
            else if (currentTag === '60F') {
                // e.g. :60F:C260810EUR10000,00
                const m = tagContent.match(/^([CD])(\d{6})([A-Z]{3})([0-9.,]+)$/);
                if (m) {
                    const sign = m[1] === 'D' ? -1 : 1;
                    const amtStr = m[4].replace('.', '').replace(',', '.');
                    openingBalance = sign * parseFloat(amtStr);
                    openingFound = true;
                }
            }
            else if (currentTag === '61') {
                // Close previous transaction if open
                if (currentTx) {
                    rawTxList.push(currentTx);
                    currentTx = null;
                }
                // Tag 61 Statement Line:
                // Format: YYMMDD[MMDD]D/C[F]AmountN...//Reference
                // e.g. :61:2608100810CD3495,00NTRFNONREF//EREF-2026-9001
                // or :61:260810C3495,00NTRF//EREF-2026-9001
                const m61 = tagContent.match(/^(\d{6})(?:\d{4})?(C|D|RC|RD)[A-Z]?([0-9.,]+)N[A-Z0-9]{3}(?:NONREF)?(?:\/\/(.*))?$/);
                if (m61) {
                    const rawDate = m61[1]; // YYMMDD
                    const year = 2000 + parseInt(rawDate.slice(0, 2), 10);
                    const month = rawDate.slice(2, 4);
                    const day = rawDate.slice(4, 6);
                    const dateStr = `${year}-${month}-${day}`;
                    const isCredit = m61[2].includes('C');
                    const amtStr = m61[3].replace('.', '').replace(',', '.');
                    const amount = Math.abs(parseFloat(amtStr));
                    const ref = m61[4] ? m61[4].trim() : undefined;
                    currentTx = {
                        date: dateStr,
                        direction: isCredit ? 'credit' : 'debit',
                        amount,
                        raw61Ref: ref,
                        raw86: '',
                    };
                }
                else {
                    // Flexible fallback match for tag 61
                    const simpleM = tagContent.match(/^(\d{6})([CD])([0-9.,]+)/);
                    if (simpleM) {
                        const rawDate = simpleM[1];
                        const year = 2000 + parseInt(rawDate.slice(0, 2), 10);
                        const month = rawDate.slice(2, 4);
                        const day = rawDate.slice(4, 6);
                        const isCredit = simpleM[2] === 'C';
                        const amount = Math.abs(parseFloat(simpleM[3].replace('.', '').replace(',', '.')));
                        currentTx = {
                            date: `${year}-${month}-${day}`,
                            direction: isCredit ? 'credit' : 'debit',
                            amount,
                            raw86: '',
                        };
                    }
                }
            }
            else if (currentTag === '86') {
                if (currentTx) {
                    currentTx.raw86 = tagContent;
                }
            }
            else if (currentTag === '62F') {
                // Tag 62F: Closing Balance (e.g. :62F:C260810EUR8585,00)
                if (currentTx) {
                    rawTxList.push(currentTx);
                    currentTx = null;
                }
                const m = tagContent.match(/^([CD])(\d{6})([A-Z]{3})([0-9.,]+)$/);
                if (m) {
                    const sign = m[1] === 'D' ? -1 : 1;
                    const amtStr = m[4].replace('.', '').replace(',', '.');
                    closingBalance = sign * parseFloat(amtStr);
                    closingFound = true;
                }
            }
        }
        else {
            // Continuation lines for current tag (especially Tag 86 narrative)
            if (currentTag === '86' && currentTx) {
                currentTx.raw86 += (currentTx.raw86 ? ' ' : '') + line.trim();
            }
        }
    }
    if (currentTx) {
        rawTxList.push(currentTx);
    }
    // Convert rawTxList to ParsedBankTransaction[]
    const transactions = rawTxList.map((item) => {
        let counterName;
        let counterIban;
        let eref = item.raw61Ref;
        let description = item.raw86 || '';
        // Parse structured Tag 86 subfields: e.g. /IBAN/NL... /NAME/... /REMI/... /EREF/...
        const ibanMatch = item.raw86.match(/(?:\/IBAN\/|IBAN:\s*)([A-Z0-9]{15,34})/i);
        if (ibanMatch)
            counterIban = ibanMatch[1].toUpperCase();
        const nameMatch = item.raw86.match(/(?:\/NAME\/|Naam:\s*)([^/]+?)(?=\/|$)/i);
        if (nameMatch)
            counterName = nameMatch[1].trim();
        const remiMatch = item.raw86.match(/(?:\/REMI\/|Omschrijving:\s*)([^/]+?)(?=\/|$)/i);
        if (remiMatch)
            description = remiMatch[1].trim();
        const erefMatch = item.raw86.match(/(?:\/EREF\/|Kenmerk:\s*)([^/]+?)(?=\/|$)/i);
        if (erefMatch)
            eref = erefMatch[1].trim();
        const tempTx = {
            bankTxId: '',
            accountIban,
            transactionDate: item.date,
            counterIban,
            counterName,
            amount: item.amount,
            direction: item.direction,
            description: description || (counterName ? `Payment from ${counterName}` : 'Bank transaction'),
            remittanceInfo: description,
            eref,
        };
        tempTx.bankTxId = generateDeterministicBankTxId(tempTx);
        return tempTx;
    });
    const totalCredits = transactions
        .filter((t) => t.direction === 'credit')
        .reduce((s, t) => s + t.amount, 0);
    const totalDebits = transactions
        .filter((t) => t.direction === 'debit')
        .reduce((s, t) => s + t.amount, 0);
    if (!closingFound && openingFound) {
        closingBalance = Math.round((openingBalance + totalCredits - totalDebits) * 100) / 100;
    }
    const header = {
        statementIdentifier,
        accountIban,
        openingBalance: Math.round(openingBalance * 100) / 100,
        closingBalance: Math.round(closingBalance * 100) / 100,
        totalCredits: Math.round(totalCredits * 100) / 100,
        totalDebits: Math.round(totalDebits * 100) / 100,
        expectedCount: transactions.length,
        fileFormat: 'mt940',
        fileName: 'statement.sta',
    };
    return { header, transactions };
}
