/**
 * Module 4: Server-Side 6-Page Offerte PDF Generator
 * 
 * Generates an official, standard-compliant PDF 1.4 document preserving the exact
 * 6-page structure from frontend Offerte6PagePDF.jsx:
 * - Page 1: Cover (Branding, Title, Subtitle, Customer details, Quote Number, Issue Date, Validity)
 * - Page 2: Persoonlijk Woord + 4 USPs (Salutation, Introduction letter, 4 USPs, Signoff Tim & Bram)
 * - Page 3: Configuratie & Specificaties + 2D Indeling + Houtsoort infobox (4 stat tiles, specs, 2D compartment layout, wood infobox)
 * - Page 4: Investeringsoverzicht + line items + inbegrepen checklist + totals + VAT + dynamic payment instalments (50/50 or 40/40/20)
 * - Page 5: Akkoord + digital signature/approval section + WhatsApp/mail actions + company details/footer
 * - Page 6: Het 5-Stappen Proces ("Van Akkoord tot Achtertuin")
 */

import type { QuoteDto, QuoteVersionDto } from './quote.types.js';

export class QuotePdfService {
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
   * Calculate dynamic instalments matching frontend quoteSchema logic
   */
  private calculateDynamicInstalments(
    totalInclVat: number,
    count = 2,
    percentages?: number[],
    customLabels?: string[]
  ): Array<{ step: number; percentage: number; label: string; amount: number; subtext: string }> {
    const validCount = Math.min(3, Math.max(2, count));
    const defaultP = validCount === 3 ? [40, 40, 20] : [50, 50];
    const rawP = percentages && percentages.length >= validCount ? percentages : defaultP;
    const p = rawP.slice(0, validCount);
    let accumulated = 0;

    return p.map((pct, idx) => {
      const defaultLabel =
        idx === 0
          ? 'Bij akkoord'
          : validCount === 3 && idx === 1
          ? 'Bij start bouw'
          : 'Bij oplevering';
      const label = customLabels && customLabels[idx] ? customLabels[idx] : defaultLabel;
      const defaultSubtext =
        validCount === 3
          ? idx === 0
            ? 'Na akkoord op de technische tekening.'
            : idx === 1
            ? 'Vlak voor de startdatum op locatie.'
            : 'Pas als alles naar wens is opgeleverd.'
          : idx === 0
          ? 'Na akkoord op de technische tekening.'
          : 'Pas als alles naar wens is opgeleverd.';

      if (idx === p.length - 1) {
        const remainder = Math.round((totalInclVat - accumulated) * 100) / 100;
        return {
          step: idx + 1,
          percentage: pct,
          label,
          amount: remainder,
          subtext: defaultSubtext,
        };
      }

      const amt = Math.round(totalInclVat * (pct / 100) * 100) / 100;
      accumulated += amt;
      return {
        step: idx + 1,
        percentage: pct,
        label,
        amount: amt,
        subtext: defaultSubtext,
      };
    });
  }

  /**
   * Generate 6-Page PDF Buffer
   */
  generatePdf(quote: QuoteDto, version?: QuoteVersionDto | null, companySettings?: any): Buffer {
    const v = version || quote.activeVersion;
    const quoteNum = quote.quoteNumber;
    const custName = quote.customerName || 'Gewaardeerde Klant';
    const custCity = quote.customerCity || 'Nederland';
    const firstName = custName.trim().split(' ')[0] || 'Klant';
    const dateStr = quote.issueDate;
    const validUntilStr = quote.validUntil;
    const totalInclNum = v ? Number(v.totalInclVat) : 0;
    const totalIncl = totalInclNum.toFixed(2);
    const subtotalExcl = v ? Number(v.subtotalExclVat).toFixed(2) : '0.00';
    const vatAmt = v ? Number(v.vatAmount).toFixed(2) : '0.00';
    const woodType = v?.woodType || 'Thermo Frake';
    const dimensions = v?.dimensionsText || '240 x 80 cm';

    // Dynamic company settings values with robust fallbacks
    const compName = companySettings?.companyName || 'Vanuit Ambacht B.V.';
    const compAddress = companySettings?.address
      ? `${companySettings.address}, ${companySettings.postalCode ? companySettings.postalCode + ' ' : ''}${companySettings.city || 'Amsterdam'}`
      : 'Koningshof 33, 3451 LM Vleuten';
    const compEmail = companySettings?.email || 'info@vanuitambacht.nl';
    const compPhone = companySettings?.phone || '06 82 00 80 25';
    const compWebsite = companySettings?.website || 'www.vanuitambacht.nl';
    const compKvk = companySettings?.kvkNumber || '93097429';
    const compBtw = companySettings?.btwNumber || 'NL866264863B01';
    const compIban = companySettings?.iban || 'NL27 ABNA 0132 2698 56';

    // Calculate dynamic instalments from version configuration
    const instConfig = v?.instalmentsConfig;
    const instalments = this.calculateDynamicInstalments(
      totalInclNum,
      instConfig?.count || 2,
      instConfig?.percentages,
      instConfig?.labels
    );

    const pagesContent: string[] = [];

    // =========================================================================
    // PAGE 1: COVER
    // =========================================================================
    pagesContent.push(`
      BT
      /F2 28 Tf
      50 780 Td
      (VANUIT AMBACHT) Tj
      0 -24 Td
      /F1 12 Tf
      (EXCLUSIEF MAATWERK & TRADITIONEEL HOUTVAKWERK) Tj
      0 -80 Td
      /F2 22 Tf
      (${this.escapePdfText(v?.coverTitleLine1 || 'EEN BUITENKEUKEN OP MAAT')}) Tj
      0 -30 Td
      (${this.escapePdfText(v?.coverTitleLine2 || `VOOR DE FAMILIE ${custName.toUpperCase()}`)}) Tj
      0 -40 Td
      /F3 13 Tf
      (${this.escapePdfText(v?.customSubtitle || `${woodType} - ${dimensions} - Op maat gemaakt`)}) Tj
      0 -200 Td
      /F2 14 Tf
      (OFFERTE DETAILS) Tj
      0 -24 Td
      /F1 11 Tf
      (Offertenummer: ${this.escapePdfText(quoteNum)}) Tj
      0 -18 Td
      (Opgesteld voor: ${this.escapePdfText(custName)}) Tj
      0 -18 Td
      (Locatie: ${this.escapePdfText(custCity)}) Tj
      0 -18 Td
      (Datum: ${this.escapePdfText(dateStr)}) Tj
      0 -18 Td
      (Geldig tot: ${this.escapePdfText(validUntilStr)}) Tj
      0 -18 Td
      (Status: ${this.escapePdfText(quote.status.toUpperCase())}) Tj
      0 -180 Td
      /F3 9 Tf
      (Pagina 1 van 6  |  Vanuit Ambacht B.V.  |  www.vanuitambacht.nl) Tj
      ET
    `);

    // =========================================================================
    // PAGE 2: PERSOONLIJK WOORD + 4 USPS
    // =========================================================================
    const defaultParas = [
      'Hartelijk dank voor je aanvraag en het prettige gesprek. Met veel plezier presenteren wij deze persoonlijke offerte voor jouw maatwerk buitenkeuken.',
      'Bij Vanuit Ambacht geloven we in duurzame materialen, ambachtelijke afwerking en oog voor detail. Wij maken al onze buitenkeukens met de hand in onze werkplaats.',
      'In dit document vind je het volledige overzicht van jouw gekozen configuratie, inclusief specificaties, vooraanzicht en transparante investering.',
      'Heb je vragen of wens je nog aanpassingen? Wij denken graag met je mee!'
    ];
    const rawParas = v?.letterConfig?.letterParagraphs;
    const letterParas = Array.isArray(rawParas) && rawParas.length > 0 ? rawParas : defaultParas;
    const p1 = letterParas[0] || defaultParas[0];
    const p2 = letterParas[1] || defaultParas[1];
    const p3 = letterParas[2] || defaultParas[2];
    const p4 = letterParas[3] || defaultParas[3];

    pagesContent.push(`
      BT
      /F2 10 Tf
      50 800 Td
      (OFFERTE ${this.escapePdfText(quoteNum)}  |  ${this.escapePdfText(custName.toUpperCase())} - ${this.escapePdfText(custCity.toUpperCase())}) Tj
      0 -35 Td
      /F2 18 Tf
      (01  PERSOONLIJK WOORD) Tj
      0 -26 Td
      /F1 12 Tf
      (${this.escapePdfText(v?.letterConfig?.salutation || `Beste ${firstName},`)}) Tj
      0 -22 Td
      /F1 10 Tf
      (${this.escapePdfText(p1)}) Tj
      0 -16 Td
      (${this.escapePdfText(p2)}) Tj
      0 -16 Td
      (${this.escapePdfText(p3)}) Tj
      0 -16 Td
      (${this.escapePdfText(p4)}) Tj
      0 -28 Td
      /F2 11 Tf
      (${this.escapePdfText(v?.letterConfig?.signoffName || 'Tim & Bram')}) Tj
      0 -14 Td
      /F3 9 Tf
      (${this.escapePdfText(v?.letterConfig?.signoffRole || 'Oprichters Vanuit Ambacht')}) Tj
      0 -42 Td
      /F2 16 Tf
      (02  WAAROM VANUIT AMBACHT (WAAR JE OP KUNT REKENEN)) Tj
      0 -26 Td
      /F2 11 Tf
      (1. Gecertificeerde Vakmensen) Tj
      0 -14 Td
      /F1 9.5 Tf
      (De bouw ligt altijd bij gecertificeerde vakspecialisten uit ons landelijke netwerk. Vakwerk van fundering tot afwerking.) Tj
      0 -22 Td
      /F2 11 Tf
      (2. Een Vast Aanspreekpunt) Tj
      0 -14 Td
      /F1 9.5 Tf
      (Je schakelt rechtstreeks met Tim of Bram via WhatsApp, mail of telefoon. Korte lijnen, snelle antwoorden.) Tj
      0 -22 Td
      /F2 11 Tf
      (3. Garantie en Nazorg) Tj
      0 -14 Td
      /F1 9.5 Tf
      (Garantie op de constructie en nazorg na oplevering. Ook als het verblijf er staat, blijven wij je aanspreekpunt.) Tj
      0 -22 Td
      /F2 11 Tf
      (4. Eerlijke Prijs, Bewust Online) Tj
      0 -14 Td
      /F1 9.5 Tf
      (Geen dure showroom is een bewuste keuze. Zo betaal je voor vakwerk en materiaal, niet voor overhead.) Tj
      0 -120 Td
      /F3 9 Tf
      (Pagina 2 van 6  |  Vanuit Ambacht B.V.  |  www.vanuitambacht.nl) Tj
      ET
    `);

    // =========================================================================
    // PAGE 3: CONFIGURATIE & SPECIFICATIES + 2D INDELING + HOUTSOORT INFOBOX
    // =========================================================================
    pagesContent.push(`
      BT
      /F2 10 Tf
      50 800 Td
      (OFFERTE ${this.escapePdfText(quoteNum)}  |  ${this.escapePdfText(custName.toUpperCase())} - ${this.escapePdfText(custCity.toUpperCase())}) Tj
      0 -35 Td
      /F2 18 Tf
      (03  UW CONFIGURATIE (IN EEN OOGOPSLAG)) Tj
      0 -30 Td
      /F2 12 Tf
      (4 KERNKENMERKEN) Tj
      0 -18 Td
      /F1 10 Tf
      (- AFMETING: ${this.escapePdfText(dimensions)} centimeter) Tj
      0 -16 Td
      (- HOUTSOORT: ${this.escapePdfText(woodType)} (Verwachte levensduur: ${this.escapePdfText(v?.woodLifespan || '20 tot 25 jaar')})) Tj
      0 -16 Td
      (- OPTIES / UITSPARING: ${this.escapePdfText(v?.optionsTitle || 'Kamado / BBQ integratie')} (${this.escapePdfText(v?.optionsSubtext || 'Rechts van het midden')})) Tj
      0 -16 Td
      (- LEVERTIJD: ${this.escapePdfText(v?.deliveryTimeText || '3 tot 5 weken')} (${this.escapePdfText(v?.deliverySubtext || 'na akkoord op tekening')})) Tj
      0 -36 Td
      /F2 12 Tf
      (SPECIFICATIES OVERZICHT) Tj
      0 -20 Td
      /F1 10 Tf
      (- Massief houten constructie met robuuste staanders en naadloze verlijming) Tj
      0 -16 Td
      (- Soft-close RVS meubelscharnieren en zware ladegeleiders) Tj
      0 -16 Td
      (- Geintegreerde zwenkwielen met remfunctie voor moeiteloze verplaatsing) Tj
      0 -16 Td
      (- Twee-laags natuurlijke beschermende olie tegen weersinvloeden) Tj
      0 -16 Td
      (- Volledig geassembleerde levering inclusief plaatsing op locatie) Tj
      0 -36 Td
      /F2 12 Tf
      (2D INDELING PLATTEGROND) Tj
      0 -20 Td
      /F1 10 Tf
      (Kast 1 (60cm)  |  Kast 2 (60cm)  |  BBQ Uitsparing (70cm)  |  Opbergvak (50cm)) Tj
      0 -36 Td
      /F2 12 Tf
      (INFOBOX: OVER ${this.escapePdfText(woodType.toUpperCase())}) Tj
      0 -20 Td
      /F1 9.5 Tf
      (Thermisch behandeld hout: buitengewoon vormstabiel, natuurlijk verduurzaamd zonder chemicalien.) Tj
      0 -16 Td
      (Behoudt jarenlang zijn warme uitstraling en veroudert in de loop der tijd stijlvol zilvergrijs.) Tj
      0 -140 Td
      /F3 9 Tf
      (Pagina 3 van 6  |  Vanuit Ambacht B.V.  |  www.vanuitambacht.nl) Tj
      ET
    `);

    // =========================================================================
    // PAGE 4: INVESTERINGSOVERZICHT + LINE ITEMS + INBEGREPEN CHECKLIST + TOTALS + DYNAMIC INSTALMENTS
    // =========================================================================
    const lineItemsText = (v?.items && v.items.length > 0)
      ? v.items.map((it) => {
          const priceDisplay = it.isIncluded || Number(it.unitPriceInclVat || 0) === 0
            ? 'Inbegrepen'
            : `EUR ${Number(it.lineTotalInclVat).toFixed(2)}`;
          return `(${this.escapePdfText(it.title)} (Aantal: ${it.quantity}) - ${priceDisplay}) Tj 0 -15 Td`;
        }).join('\n')
      : `(Maatwerk Meubel Compleet - EUR ${totalIncl}) Tj 0 -15 Td`;

    const instalmentsText = instalments.map((inst) => {
      return `(Termijn ${inst.step}: ${inst.percentage}% - ${this.escapePdfText(inst.label)}: EUR ${inst.amount.toFixed(2)} (${this.escapePdfText(inst.subtext)})) Tj 0 -15 Td`;
    }).join('\n');

    pagesContent.push(`
      BT
      /F2 10 Tf
      50 800 Td
      (OFFERTE ${this.escapePdfText(quoteNum)}  |  ${this.escapePdfText(custName.toUpperCase())} - ${this.escapePdfText(custCity.toUpperCase())}) Tj
      0 -35 Td
      /F2 18 Tf
      (04  INVESTERINGSOVERZICHT) Tj
      0 -26 Td
      /F2 11 Tf
      (GESPECIFICEERDE ONDERDELEN) Tj
      0 -18 Td
      /F1 9.5 Tf
      ${lineItemsText}
      0 -10 Td
      /F3 8.5 Tf
      (* Stelpost: dit bedrag is een zorgvuldige inschatting op basis van werkelijke kosten.) Tj
      0 -24 Td
      /F2 11 Tf
      (INBEGREPEN BIJ JOUW INVESTERING) Tj
      0 -16 Td
      /F1 9.5 Tf
      (- Ontwerp en technische tekening voor de bouw) Tj
      0 -14 Td
      (- Schouw op locatie voor de start van de bouw) Tj
      0 -14 Td
      (- Bouw door een gecertificeerde vakspecialist) Tj
      0 -14 Td
      (- Transport, montage en opruimen van de bouwplaats) Tj
      0 -14 Td
      (- Garantie op de constructie en nazorg na oplevering) Tj
      0 -24 Td
      /F2 11 Tf
      (TOTAAL FINANCIEEL OVERZICHT) Tj
      0 -16 Td
      /F1 9.5 Tf
      (Subtotaal exclusief 21% BTW: EUR ${subtotalExcl}) Tj
      0 -14 Td
      (BTW Bedrag (21%): EUR ${vatAmt}) Tj
      0 -16 Td
      /F2 11 Tf
      (TOTAAL INCLUSIEF BTW: EUR ${totalIncl}) Tj
      0 -14 Td
      /F3 8.5 Tf
      (Deze offerte is geldig tot en met ${this.escapePdfText(validUntilStr)}) Tj
      0 -24 Td
      /F2 11 Tf
      (BETALINGSTERMIJNEN (${instalments.length === 3 ? 'DRIE' : 'TWEE'} TERMIJNEN)) Tj
      0 -16 Td
      /F1 9.5 Tf
      ${instalmentsText}
      0 -40 Td
      /F3 9 Tf
      (Pagina 4 van 6  |  Vanuit Ambacht B.V.  |  www.vanuitambacht.nl) Tj
      ET
    `);

    // =========================================================================
    // PAGE 5: AKKOORD + SIGNATURE / APPROVAL + CONTACT ACTIONS + COMPANY DETAILS
    // =========================================================================
    const isApproved =
      quote.status === 'approved' ||
      Boolean(v?.digitalSignature?.signerName) ||
      Boolean(v?.digitalSignature?.approvedAt);

    const auditBadgeText = isApproved
      ? `Officieel Digitaal Geaccepteerd door ${v?.digitalSignature?.signerName || custName} op ${v?.digitalSignature?.approvedAt || dateStr} (Rechtsgeldig)`
      : 'In afwachting van digitale ondertekening / akkoord';

    pagesContent.push(`
      BT
      /F2 10 Tf
      50 800 Td
      (OFFERTE ${this.escapePdfText(quoteNum)}  |  ${this.escapePdfText(custName.toUpperCase())} - ${this.escapePdfText(custCity.toUpperCase())}) Tj
      0 -35 Td
      /F2 18 Tf
      (05  AKKOORD & HANDTEKENINGEN) Tj
      0 -26 Td
      /F2 12 Tf
      (ZULLEN WE HEM GAAN MAKEN?) Tj
      0 -18 Td
      /F1 10 Tf
      (Akkoord geven kan in een minuut. Stuur een korte bevestiging per WhatsApp of mail,) Tj
      0 -15 Td
      (of onderteken hieronder. Daarna ontvang je het definitieve ontwerp ter bevestiging.) Tj
      0 -26 Td
      /F2 11 Tf
      (SNELLE CONTACTOPTIES) Tj
      0 -16 Td
      /F1 10 Tf
      (WhatsApp: 06 82 00 80 25  |  E-mail: info@vanuitambacht.nl) Tj
      0 -16 Td
      (Online Goedkeuring Link: https://vanuitambacht.nl/offerte/${this.escapePdfText(quote.publicToken)}) Tj
      0 -32 Td
      /F2 11 Tf
      (VOOR AKKOORD - OPDRACHTGEVER) Tj
      0 -18 Td
      /F1 10 Tf
      (Naam: ${this.escapePdfText(custName)}) Tj
      0 -16 Td
      (Datum: ${this.escapePdfText(v?.digitalSignature?.approvedAt || '..............................')}) Tj
      0 -16 Td
      (Handtekening: ${this.escapePdfText(v?.digitalSignature?.signerName ? '(Digitaal Goedgekeurd)' : '..............................')}) Tj
      0 -30 Td
      /F2 11 Tf
      (NAMENS VANUIT AMBACHT) Tj
      0 -18 Td
      /F1 10 Tf
      (Naam: Tim & Bram - Oprichters Vanuit Ambacht) Tj
      0 -16 Td
      (Datum: ${this.escapePdfText(dateStr)}) Tj
      0 -16 Td
      (Handtekening: Vanuit Ambacht B.V.) Tj
      0 -28 Td
      /F2 10 Tf
      (DIGITAAL AUDIT RAPPORT:) Tj
      0 -14 Td
      /F3 9.5 Tf
      (${this.escapePdfText(auditBadgeText)}) Tj
      0 -40 Td
      /F2 10 Tf
      (BEDRIJFSGEGEVENS ${this.escapePdfText(compName.toUpperCase())}) Tj
      0 -16 Td
      /F1 9 Tf
      (Adres: ${this.escapePdfText(compAddress)}) Tj
      0 -14 Td
      (Contact: ${this.escapePdfText(compPhone)}  |  ${this.escapePdfText(compEmail)}  |  ${this.escapePdfText(compWebsite)}) Tj
      0 -14 Td
      (Gegevens: KVK: ${this.escapePdfText(compKvk)}  |  BTW: ${this.escapePdfText(compBtw)}  |  IBAN: ${this.escapePdfText(compIban)}) Tj
      0 -70 Td
      /F3 9 Tf
      (Pagina 5 van 6  |  ${this.escapePdfText(compName)}  |  ${this.escapePdfText(compWebsite)}) Tj
      ET
    `);

    // =========================================================================
    // PAGE 6: HET 5-STAPPEN PROCES ("VAN AKKOORD TOT ACHTERTUIN")
    // =========================================================================
    pagesContent.push(`
      BT
      /F2 10 Tf
      50 800 Td
      (OFFERTE ${this.escapePdfText(quoteNum)}  |  ${this.escapePdfText(custName.toUpperCase())} - ${this.escapePdfText(custCity.toUpperCase())}) Tj
      0 -35 Td
      /F2 18 Tf
      (06  VAN AKKOORD TOT ACHTERTUIN (HET 5-STAPPEN PROCES)) Tj
      0 -36 Td
      /F2 12 Tf
      (Stap 1: Akkoord op de offerte) Tj
      0 -16 Td
      /F1 10 Tf
      (Bevestig eenvoudig per mail of WhatsApp, of onderteken de akkoordpagina.) Tj
      0 -14 Td
      (Vanaf dat moment nemen wij alles uit handen en starten we met de voorbereiding.) Tj
      0 -26 Td
      /F2 12 Tf
      (Stap 2: Ontwerp en technische tekening) Tj
      0 -16 Td
      /F1 10 Tf
      (Je ontvangt het definitieve ontwerp met technische tekening ter bevestiging.) Tj
      0 -14 Td
      (Zo weet je precies wat er gebouwd wordt voor de bouw definitief van start gaat.) Tj
      0 -26 Td
      /F2 12 Tf
      (Stap 3: Schouw op locatie) Tj
      0 -16 Td
      /F1 10 Tf
      (Onze vakspecialist komt langs om de ondergrond, bereikbaarheid en aansluitingen) Tj
      0 -14 Td
      (te controleren. Daarna plannen we direct de definitieve bouwdatum in.) Tj
      0 -26 Td
      /F2 12 Tf
      (Stap 4: De bouw (2 TOT 3 WEKEN DOORLOOPTIJD)) Tj
      0 -16 Td
      /F1 10 Tf
      (Jouw buitenverblijf wordt op locatie gebouwd door een gecertificeerde) Tj
      0 -14 Td
      (vakspecialist. Tussentijds houden we je continu op de hoogte van de voortgang.) Tj
      0 -26 Td
      /F2 12 Tf
      (Stap 5: Oplevering, garantie & nazorg) Tj
      0 -16 Td
      /F1 10 Tf
      (We leveren pas op als alles naar wens is. Ook daarna blijven wij je vaste) Tj
      0 -14 Td
      (aanspreekpunt, inclusief meerjarige constructieve garantie op het meubel.) Tj
      0 -120 Td
      /F3 9 Tf
      (Pagina 6 van 6  |  Vanuit Ambacht B.V.  |  www.vanuitambacht.nl) Tj
      ET
    `);

    return this.assemblePdfDocument(pagesContent);
  }

  /**
   * Assembles a 6-page PDF binary file
   */
  private assemblePdfDocument(pagesContent: string[]): Buffer {
    const objects: string[] = [];

    // Obj 1: Catalog
    objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);

    // Obj 2: Pages Tree
    const pageObjNums = [3, 5, 7, 9, 11, 13];
    const kidsStr = pageObjNums.map((n) => `${n} 0 R`).join(' ');
    objects.push(`<< /Type /Pages /Kids [${kidsStr}] /Count 6 >>`);

    // Font definitions: Obj 15 (F1 = Helvetica), Obj 16 (F2 = Helvetica-Bold), Obj 17 (F3 = Helvetica-Oblique)
    const fontObjF1 = 15;
    const fontObjF2 = 16;
    const fontObjF3 = 17;

    // Create 6 Pages and their Content Streams
    for (let i = 0; i < 6; i++) {
      const pageIndex = i;
      const contentObjNum = (pageIndex + 2) * 2;
      const streamContent = pagesContent[i] || 'BT /F1 12 Tf 50 700 Td (Page) Tj ET';
      const streamBytes = Buffer.from(streamContent, 'utf-8');

      // Page Object
      objects.push(`<<
        /Type /Page
        /Parent 2 0 R
        /MediaBox [0 0 595.28 841.89]
        /Contents ${contentObjNum} 0 R
        /Resources <<
          /Font <<
            /F1 ${fontObjF1} 0 R
            /F2 ${fontObjF2} 0 R
            /F3 ${fontObjF3} 0 R
          >>
        >>
      >>`);

      // Content Stream Object
      objects.push(`<< /Length ${streamBytes.length} >>\nstream\n${streamContent}\nendstream`);
    }

    // Font Objects
    objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`); // Obj 15
    objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`); // Obj 16
    objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>`); // Obj 17

    // Build Byte Offsets and XREF
    let body = `%PDF-1.4\n%\xE2\xE3\xCF\xD3\n`;
    const xrefOffsets: number[] = [0];

    for (let i = 0; i < objects.length; i++) {
      const objNum = i + 1;
      xrefOffsets[objNum] = Buffer.byteLength(body, 'utf-8');
      body += `${objNum} 0 obj\n${objects[i]}\nendobj\n`;
    }

    const startXref = Buffer.byteLength(body, 'utf-8');
    body += `xref\n0 ${objects.length + 1}\n`;
    body += `0000000000 65535 f \n`;

    for (let i = 1; i <= objects.length; i++) {
      const offset = xrefOffsets[i].toString().padStart(10, '0');
      body += `${offset} 00000 n \n`;
    }

    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;

    return Buffer.from(body, 'utf-8');
  }
}

export const quotePdfService = new QuotePdfService();
