import type { ParsedBankTransaction, StatementHeaderInfo } from '../bank.types.js';
import { generateDeterministicBankTxId } from './statement.validator.js';

export function parseCamt053(xmlContent: string, defaultIban: string = 'NL44ABNA0987654321'): {
  header: StatementHeaderInfo;
  transactions: ParsedBankTransaction[];
} {
  // Helper to extract text from simple tag
  const getTagValue = (xml: string, tag: string): string | null => {
    const regex = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${tag}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
  };

  const msgId = getTagValue(xmlContent, 'MsgId') || 'CAMT053-MSG';
  const stmtId = getTagValue(xmlContent, 'Id') || msgId;
  const accountIban = getTagValue(xmlContent, 'IBAN')?.replace(/\s+/g, '') || defaultIban;

  let openingBalance = 0;
  let closingBalance = 0;

  // Extract balances: <Bal> blocks with OPBD (Opening) and CLBD (Closing)
  const balRegex = /<(?:[a-zA-Z0-9_]+:)?Bal[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_]+:)?Bal>/gi;
  let balMatch: RegExpExecArray | null;

  while ((balMatch = balRegex.exec(xmlContent)) !== null) {
    const balXml = balMatch[1];
    const code = getTagValue(balXml, 'Cd');
    const amtStr = getTagValue(balXml, 'Amt');
    const cdtDbt = getTagValue(balXml, 'CdtDbtInd'); // CRDT or DBIT

    if (amtStr) {
      const num = parseFloat(amtStr.replace(',', '.'));
      const sign = cdtDbt === 'DBIT' ? -1 : 1;
      if (code === 'OPBD' || code === 'PRCD') {
        openingBalance = sign * num;
      } else if (code === 'CLBD' || code === 'ITBD') {
        closingBalance = sign * num;
      }
    }
  }

  // Extract transactions: <Ntry> blocks
  const transactions: ParsedBankTransaction[] = [];
  const ntryRegex = /<(?:[a-zA-Z0-9_]+:)?Ntry[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_]+:)?Ntry>/gi;
  let ntryMatch: RegExpExecArray | null;

  while ((ntryMatch = ntryRegex.exec(xmlContent)) !== null) {
    const ntryXml = ntryMatch[1];
    const amtStr = getTagValue(ntryXml, 'Amt');
    if (!amtStr) continue;

    const amount = Math.abs(parseFloat(amtStr.replace(',', '.')));
    const cdtDbtInd = getTagValue(ntryXml, 'CdtDbtInd'); // CRDT (credit) or DBIT (debit)
    const direction: 'credit' | 'debit' = cdtDbtInd === 'DBIT' ? 'debit' : 'credit';

    // Booking Date
    let dateStr =
      getTagValue(ntryXml, 'Dt') ||
      getTagValue(ntryXml, 'DtTm')?.slice(0, 10) ||
      new Date().toISOString().slice(0, 10);
    if (dateStr.length > 10) dateStr = dateStr.slice(0, 10);

    // Value Date
    const valDt = getTagValue(ntryXml, 'ValDt');
    const valueDate = valDt ? (getTagValue(valDt, 'Dt') || dateStr) : undefined;

    // Transaction Details
    const endToEndId = getTagValue(ntryXml, 'EndToEndId');
    const eref = endToEndId && endToEndId !== 'NOTPROVIDED' ? endToEndId : undefined;

    // Counterparty
    let counterName =
      direction === 'credit'
        ? getTagValue(ntryXml, 'Dbtr') ? getTagValue(getTagValue(ntryXml, 'Dbtr')!, 'Nm') : null
        : getTagValue(ntryXml, 'Cdtr') ? getTagValue(getTagValue(ntryXml, 'Cdtr')!, 'Nm') : null;

    if (!counterName) {
      counterName = getTagValue(ntryXml, 'Nm');
    }

    let counterIban =
      direction === 'credit'
        ? getTagValue(ntryXml, 'DbtrAcct') ? getTagValue(getTagValue(ntryXml, 'DbtrAcct')!, 'IBAN') : null
        : getTagValue(ntryXml, 'CdtrAcct') ? getTagValue(getTagValue(ntryXml, 'CdtrAcct')!, 'IBAN') : null;

    if (!counterIban) {
      const allIbans = ntryXml.match(/<IBAN>([A-Z0-9]{15,34})<\/IBAN>/i);
      if (allIbans && allIbans[1] !== accountIban) {
        counterIban = allIbans[1];
      }
    }

    // Remittance Info
    const ustrd = getTagValue(ntryXml, 'Ustrd');
    const addtlNtryInf = getTagValue(ntryXml, 'AddtlNtryInf');
    const description = ustrd || addtlNtryInf || (counterName ? `Payment from ${counterName}` : 'Bank transaction');

    const tempTx: ParsedBankTransaction = {
      bankTxId: '',
      accountIban,
      transactionDate: dateStr,
      valueDate,
      counterIban: counterIban?.replace(/\s+/g, ''),
      counterName: counterName || undefined,
      amount,
      direction,
      description,
      remittanceInfo: ustrd || undefined,
      eref,
    };

    tempTx.bankTxId = generateDeterministicBankTxId(tempTx);
    transactions.push(tempTx);
  }

  const totalCredits = transactions
    .filter((t) => t.direction === 'credit')
    .reduce((s, t) => s + t.amount, 0);
  const totalDebits = transactions
    .filter((t) => t.direction === 'debit')
    .reduce((s, t) => s + t.amount, 0);

  if (closingBalance === 0 && openingBalance !== 0) {
    closingBalance = Math.round((openingBalance + totalCredits - totalDebits) * 100) / 100;
  }

  const header: StatementHeaderInfo = {
    statementIdentifier: stmtId,
    accountIban,
    openingBalance: Math.round(openingBalance * 100) / 100,
    closingBalance: Math.round(closingBalance * 100) / 100,
    totalCredits: Math.round(totalCredits * 100) / 100,
    totalDebits: Math.round(totalDebits * 100) / 100,
    expectedCount: transactions.length,
    fileFormat: 'camt053',
    fileName: 'statement.xml',
  };

  return { header, transactions };
}
