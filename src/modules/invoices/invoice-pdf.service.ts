import { db } from '../../db/index.js';
import { invoices, invoiceItems, customers, projects, companySettings } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export class InvoicePdfService {
  /**
   * Escape text for PDF text stream
   */
  private escapePdfText(text?: string | null): string {
    if (!text) return '';
    return String(text)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/€/g, 'EUR ')
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
  }

  /**
   * Format numbers to Dutch currency string: € 1.234,56
   */
  private formatCurrency(amount: number): string {
    return (
      'EUR ' +
      amount.toLocaleString('nl-NL', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  /**
   * Format ISO date to Dutch readable date (e.g. 1 augustus 2026)
   */
  private formatDutchDate(isoDate?: string | null): string {
    if (!isoDate) return '';
    try {
      const d = new Date(isoDate);
      if (isNaN(d.getTime())) return String(isoDate);
      return d.toLocaleDateString('nl-NL', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return String(isoDate);
    }
  }

  /**
   * Wrap raw PDF text/graphics into a valid standard PDF-1.4 file buffer
   */
  private createPdfDocument(pages: string[]): Buffer {
    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];

    // Object 1: Catalog
    offsets.push(pdf.length);
    pdf += '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';

    // Object 2: Pages
    offsets.push(pdf.length);
    const pageRefs = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
    pdf += `2 0 obj\n<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>\nendobj\n`;

    // Object 3: Standard fonts
    offsets.push(pdf.length);
    pdf +=
      '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';

    // Object 3b: Bold font
    offsets.push(pdf.length);
    pdf +=
      '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n';

    // Render each page (Object 5, 7, 9... for Page, Object 6, 8, 10... for Content stream)
    pages.forEach((streamContent, i) => {
      const pageObjNum = 5 + i * 2;
      const streamObjNum = 6 + i * 2;

      offsets.push(pdf.length);
      pdf += `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamObjNum} 0 R >>\nendobj\n`;

      offsets.push(pdf.length);
      pdf += `${streamObjNum} 0 obj\n<< /Length ${Buffer.byteLength(streamContent, 'utf-8')} >>\nstream\n${streamContent}\nendstream\nendobj\n`;
    });

    const xrefOffset = pdf.length;
    const totalObjects = 4 + pages.length * 2;
    pdf += `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;

    offsets.forEach((off) => {
      pdf += `${off.toString().padStart(10, '0')} 00000 n \n`;
    });

    pdf += `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(pdf, 'utf-8');
  }

  /**
   * Generates official Dutch Factuur PDF buffer for the given invoice ID
   */
  async generateFactuurPdf(invoiceId: string): Promise<Buffer> {
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);

    if (!invoice) {
      throw new Error(`Invoice with ID ${invoiceId} not found`);
    }

    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, invoice.customerId))
      .limit(1);

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, invoice.projectId))
      .limit(1);

    const items = await db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, invoiceId))
      .orderBy(invoiceItems.position);

    // Fetch authoritative company settings from DB
    const [compSettings] = await db.select().from(companySettings).limit(1);

    const compName = compSettings?.companyName || 'Vanuit Ambacht B.V.';
    const compAddress = compSettings?.address
      ? `${compSettings.address}, ${compSettings.postalCode || ''} ${compSettings.city || 'Vleuten'}`
      : 'Koningshof 33, 3451 LM Vleuten';
    const compKvk = compSettings?.kvkNumber ? `KVK ${compSettings.kvkNumber}` : 'KVK 93097429';
    const compBtw = compSettings?.btwNumber ? `BTW ${compSettings.btwNumber}` : 'BTW NL866264863B01';
    const compIban = compSettings?.iban || 'NL27 ABNA 0132 2698 56';
    const compEmail = compSettings?.email || 'info@vanuitambacht.nl';
    const compPhone = compSettings?.phone || '06 82 00 80 25';

    // Customer formatting
    const custFullName = customer
      ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.companyName || 'Klant'
      : 'Klant';
    const custStreet = customer?.streetAddress || project?.deliveryAddress || 'Adres onbekend';
    const custCity = `${customer?.postalCode || project?.postalCode || ''} ${customer?.city || project?.city || ''}`.trim();
    const custPhone = customer?.phone || '';

    const isCreditNote = invoice.invoiceType === 'credit_note';
    const docTitle = isCreditNote ? 'CREDIT FACTUUR' : 'FACTUUR';
    const invoiceNumber = invoice.invoiceNumber;
    const issueDateStr = this.formatDutchDate(invoice.issueDate);
    const dueDateStr = this.formatDutchDate(invoice.dueDate);
    const refStr = project?.projectNumber || 'Vanuit Ambacht';

    const subtotalExcl = parseFloat(invoice.subtotalExclVat || '0');
    const totalVat = parseFloat(invoice.totalVatAmount || '0');
    const totalIncl = parseFloat(invoice.totalInclVat || '0');

    // Page 1 Content Stream
    let stream = '';

    // Color definitions
    // Dark Green Header / Brand: 0.17 0.22 0.15 (RGB #2C3826)
    // Gold/Amber accent: 0.75 0.55 0.25
    // Warm Background card fill: 0.96 0.95 0.92

    // 1. TOP HEADER & BADGE
    stream += `q\n`;
    stream += `0.17 0.22 0.15 rg\n`; // Brand dark green
    stream += `BT /F2 18 Tf 50 790 Td (${this.escapePdfText(compName)}) Tj ET\n`;
    stream += `0.54 0.47 0.40 rg\n`;
    stream += `BT /F1 9 Tf 50 776 Td (${this.escapePdfText(compAddress)}) Tj ET\n`;
    stream += `BT /F1 9 Tf 50 764 Td (${this.escapePdfText(compKvk)}  |  ${this.escapePdfText(compBtw)}) Tj ET\n`;

    // Right Badge
    stream += `0.92 0.90 0.85 rg\n`;
    stream += `420 770 125 24 re f\n`;
    stream += `0.17 0.22 0.15 RG 1 w 420 770 125 24 re s\n`;
    stream += `0.17 0.22 0.15 rg\n`;
    stream += `BT /F2 11 Tf 440 778 Td (${this.escapePdfText(docTitle)}) Tj ET\n`;
    stream += `Q\n`;

    // Divider line
    stream += `q 0.80 0.78 0.72 RG 1 w 50 745 m 545 745 l S Q\n`;

    // 2. 4-COLUMN SUMMARY CARD
    stream += `q\n`;
    stream += `0.96 0.95 0.92 rg\n`;
    stream += `50 675 495 55 re f\n`;
    stream += `0.85 0.83 0.78 RG 1 w 50 675 495 55 re s\n`;

    // Headers
    stream += `0.54 0.47 0.40 rg\n`;
    stream += `BT /F2 8 Tf 65 712 Td (FACTUURNUMMER) Tj ET\n`;
    stream += `BT /F2 8 Tf 185 712 Td (FACTUURDATUM) Tj ET\n`;
    stream += `BT /F2 8 Tf 305 712 Td (VERVALDATUM) Tj ET\n`;
    stream += `BT /F2 8 Tf 425 712 Td (REFERENTIE) Tj ET\n`;

    // Values
    stream += `0.17 0.22 0.15 rg\n`;
    stream += `BT /F2 10 Tf 65 692 Td (${this.escapePdfText(invoiceNumber)}) Tj ET\n`;
    stream += `BT /F1 9 Tf 185 692 Td (${this.escapePdfText(issueDateStr)}) Tj ET\n`;
    stream += `BT /F1 9 Tf 305 692 Td (${this.escapePdfText(dueDateStr)}) Tj ET\n`;
    stream += `BT /F1 9 Tf 425 692 Td (${this.escapePdfText(refStr)}) Tj ET\n`;
    stream += `Q\n`;

    // 3. ADDRESS BLOCKS
    stream += `q\n`;
    // Left: Factuur Aan
    stream += `0.54 0.47 0.40 rg\n`;
    stream += `BT /F2 8 Tf 50 655 Td (FACTUUR AAN) Tj ET\n`;
    stream += `0.17 0.22 0.15 rg\n`;
    stream += `BT /F2 11 Tf 50 640 Td (${this.escapePdfText(custFullName)}) Tj ET\n`;
    stream += `0.30 0.32 0.28 rg\n`;
    stream += `BT /F1 9 Tf 50 626 Td (${this.escapePdfText(custStreet)}) Tj ET\n`;
    stream += `BT /F1 9 Tf 50 614 Td (${this.escapePdfText(custCity)}) Tj ET\n`;
    if (custPhone) {
      stream += `BT /F1 8 Tf 50 602 Td (Tel: ${this.escapePdfText(custPhone)}) Tj ET\n`;
    }

    // Right: Factuur Van
    stream += `0.54 0.47 0.40 rg\n`;
    stream += `BT /F2 8 Tf 320 655 Td (FACTUUR VAN) Tj ET\n`;
    stream += `0.17 0.22 0.15 rg\n`;
    stream += `BT /F2 11 Tf 320 640 Td (${this.escapePdfText(compName)}) Tj ET\n`;
    stream += `0.30 0.32 0.28 rg\n`;
    stream += `BT /F1 9 Tf 320 626 Td (${this.escapePdfText(compAddress)}) Tj ET\n`;
    stream += `BT /F1 9 Tf 320 614 Td (IBAN: ${this.escapePdfText(compIban)}) Tj ET\n`;
    stream += `BT /F1 8 Tf 320 602 Td (${this.escapePdfText(compEmail)}  |  ${this.escapePdfText(compPhone)}) Tj ET\n`;
    stream += `Q\n`;

    // 4. LINE ITEMS TABLE
    const tableTop = 575;
    stream += `q\n`;
    // Table Header Bar
    stream += `0.20 0.25 0.18 rg\n`;
    stream += `50 ${tableTop} 495 22 re f\n`;
    stream += `1 1 1 rg\n`;
    stream += `BT /F2 8 Tf 60 ${tableTop + 7} Td (OMSCHRIJVING) Tj ET\n`;
    stream += `BT /F2 8 Tf 380 ${tableTop + 7} Td (AANTAL) Tj ET\n`;
    stream += `BT /F2 8 Tf 460 ${tableTop + 7} Td (BEDRAG) Tj ET\n`;
    stream += `Q\n`;

    let currentY = tableTop - 25;
    items.forEach((it, idx) => {
      stream += `q\n`;
      // Alternating row background
      if (idx % 2 === 1) {
        stream += `0.98 0.98 0.96 rg 50 ${currentY - 12} 495 26 re f\n`;
      }

      // Title
      stream += `0.15 0.18 0.14 rg\n`;
      stream += `BT /F2 9.5 Tf 60 ${currentY} Td (${this.escapePdfText(it.description)}) Tj ET\n`;

      // Subtext if any
      if (it.subtext) {
        stream += `0.45 0.48 0.42 rg\n`;
        stream += `BT /F1 7.5 Tf 60 ${currentY - 10} Td (${this.escapePdfText(it.subtext.substring(0, 75))}) Tj ET\n`;
      }

      // Quantity
      stream += `0.20 0.22 0.18 rg\n`;
      stream += `BT /F1 9 Tf 395 ${currentY} Td (${it.quantity}) Tj ET\n`;

      // Price
      const itemPrice = it.isIncluded
        ? 'Inbegrepen'
        : this.formatCurrency(parseFloat(it.lineTotalInclVat || '0'));
      stream += `BT /F2 9.5 Tf 460 ${currentY} Td (${this.escapePdfText(itemPrice)}) Tj ET\n`;

      // Separator line
      stream += `0.90 0.88 0.84 RG 0.5 w 50 ${currentY - 14} m 545 ${currentY - 14} l S\n`;
      stream += `Q\n`;

      currentY -= it.subtext ? 32 : 24;
    });

    // 5. BOTTOM SECTION: PAYMENT INSTRUCTIONS (LEFT) & TOTALS CARD (RIGHT)
    const bottomY = Math.max(currentY - 10, 200);

    // Left Box: Betaalinformatie
    stream += `q\n`;
    stream += `0.96 0.95 0.92 rg\n`;
    stream += `50 ${bottomY - 110} 250 110 re f\n`;
    stream += `0.85 0.83 0.78 RG 1 w 50 ${bottomY - 110} 250 110 re s\n`;

    stream += `0.54 0.47 0.40 rg\n`;
    stream += `BT /F2 8 Tf 65 ${bottomY - 20} Td (BETAALINFORMATIE) Tj ET\n`;
    stream += `0.30 0.32 0.28 rg\n`;
    stream += `BT /F1 8.5 Tf 65 ${bottomY - 35} Td (Maak het totaalbedrag over binnen 14 dagen op:) Tj ET\n`;
    stream += `0.17 0.22 0.15 rg\n`;
    stream += `BT /F2 11 Tf 65 ${bottomY - 52} Td (${this.escapePdfText(compIban)}) Tj ET\n`;
    stream += `0.30 0.32 0.28 rg\n`;
    stream += `BT /F1 8.5 Tf 65 ${bottomY - 68} Td (t.n.v. ${this.escapePdfText(compName)}) Tj ET\n`;
    stream += `0.17 0.22 0.15 rg\n`;
    stream += `BT /F2 8.5 Tf 65 ${bottomY - 88} Td (o.v.v. factuurnummer ${this.escapePdfText(invoiceNumber)}) Tj ET\n`;
    stream += `Q\n`;

    // Right Box: Totals & BTW (Brand Green Box)
    stream += `q\n`;
    stream += `0.20 0.26 0.18 rg\n`;
    stream += `315 ${bottomY - 110} 230 110 re f\n`;
    stream += `0.15 0.20 0.13 RG 1 w 315 ${bottomY - 110} 230 110 re s\n`;

    // Excl VAT
    stream += `0.80 0.85 0.78 rg\n`;
    stream += `BT /F1 9 Tf 330 ${bottomY - 25} Td (Totaal excl. btw:) Tj ET\n`;
    stream += `1 1 1 rg\n`;
    stream += `BT /F2 9.5 Tf 450 ${bottomY - 25} Td (${this.escapePdfText(this.formatCurrency(subtotalExcl))}) Tj ET\n`;

    // VAT 21%
    stream += `0.80 0.85 0.78 rg\n`;
    stream += `BT /F1 9 Tf 330 ${bottomY - 45} Td (Btw 21%:) Tj ET\n`;
    stream += `1 1 1 rg\n`;
    stream += `BT /F2 9.5 Tf 450 ${bottomY - 45} Td (${this.escapePdfText(this.formatCurrency(totalVat))}) Tj ET\n`;

    // Divider
    stream += `0.40 0.48 0.38 RG 1 w 330 ${bottomY - 55} m 530 ${bottomY - 55} l S\n`;

    // Te Betalen (Incl. VAT)
    stream += `0.95 0.85 0.65 rg\n`; // Warm gold label
    stream += `BT /F2 10 Tf 330 ${bottomY - 78} Td (Te betalen:) Tj ET\n`;
    stream += `1 1 1 rg\n`;
    stream += `BT /F2 13 Tf 435 ${bottomY - 78} Td (${this.escapePdfText(this.formatCurrency(totalIncl))}) Tj ET\n`;

    // Payment due date note
    stream += `0.80 0.85 0.78 rg\n`;
    stream += `BT /F1 7.5 Tf 330 ${bottomY - 98} Td (Betaaltermijn: 14 dagen  |  Voor ${this.escapePdfText(dueDateStr)}) Tj ET\n`;
    stream += `Q\n`;

    // 6. PERSONAL COURTESY NOTE (Bottom banner)
    stream += `q\n`;
    stream += `0.97 0.96 0.94 rg 50 65 495 32 re f\n`;
    stream += `0.20 0.26 0.18 RG 1.5 w 50 65 0 32 re s\n`;
    stream += `0.20 0.26 0.18 rg\n`;
    const courtesyText = project?.projectType === 'garden_room'
      ? 'Veel plezier van je nieuwe buitenverblijf. Vragen of iets nodig? Je weet ons te vinden.'
      : 'Veel plezier van je buitenkeuken. Vragen of iets nodig? Je weet ons te vinden.';
    stream += `BT /F1 8.5 Tf 60 83 Td (${this.escapePdfText(courtesyText)}) Tj ET\n`;
    stream += `0.54 0.47 0.40 rg\n`;
    stream += `BT /F2 7.5 Tf 60 72 Td (TIM & BRAM  ·  ${this.escapePdfText(compName.toUpperCase())}) Tj ET\n`;
    stream += `Q\n`;

    // 7. FOOTER
    stream += `q\n`;
    stream += `0.80 0.78 0.72 RG 0.5 w 50 48 m 545 48 l S\n`;
    stream += `0.55 0.52 0.46 rg\n`;
    stream += `BT /F1 7.5 Tf 50 36 Td (${this.escapePdfText(compName)}  |  ${this.escapePdfText(compAddress)}  |  ${this.escapePdfText(compEmail)}  |  ${this.escapePdfText(compPhone)}) Tj ET\n`;
    stream += `BT /F1 7.5 Tf 480 36 Td (Pagina 1 van 1) Tj ET\n`;
    stream += `Q\n`;

    return this.createPdfDocument([stream]);
  }
}

export const invoicePdfService = new InvoicePdfService();
