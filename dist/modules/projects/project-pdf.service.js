export class ProjectPdfService {
    /**
     * Escape text for PDF text stream
     */
    escapePdfText(text) {
        if (!text)
            return '';
        return String(text)
            .replace(/\\/g, '\\\\')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)')
            .replace(/€/g, 'EUR ')
            .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
    }
    /**
     * Wrap raw PDF text/graphics into a valid standard PDF-1.4 file buffer
     */
    createPdfDocument(pages) {
        let pdf = '%PDF-1.4\n';
        const offsets = [];
        // Object 1: Catalog
        offsets.push(pdf.length);
        pdf += '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
        // Object 2: Pages
        offsets.push(pdf.length);
        const pageRefs = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
        pdf += `2 0 obj\n<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>\nendobj\n`;
        // Object 3: Standard font
        offsets.push(pdf.length);
        pdf += '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
        // Render each page (Object 4, 6, 8... for Page, Object 5, 7, 9... for Content stream)
        pages.forEach((streamContent, i) => {
            const pageObjNum = 4 + i * 2;
            const streamObjNum = 5 + i * 2;
            offsets.push(pdf.length);
            pdf += `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamObjNum} 0 R >>\nendobj\n`;
            offsets.push(pdf.length);
            pdf += `${streamObjNum} 0 obj\n<< /Length ${Buffer.byteLength(streamContent, 'utf-8')} >>\nstream\n${streamContent}\nendstream\nendobj\n`;
        });
        const xrefOffset = pdf.length;
        const totalObjects = 3 + pages.length * 2;
        pdf += 'xref\n';
        pdf += `0 ${totalObjects + 1}\n`;
        pdf += '0000000000 65535 f \n';
        for (const offset of offsets) {
            pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
        }
        pdf += 'trailer\n';
        pdf += `<< /Size ${totalObjects + 1} /Root 1 0 R >>\n`;
        pdf += 'startxref\n';
        pdf += `${xrefOffset}\n`;
        pdf += '%%EOF';
        return Buffer.from(pdf, 'utf-8');
    }
    /**
     * Generate Werkorder PDF for craftsmen / partners
     * Strictly omits customer selling price, contract value, and profit margins!
     */
    generateWerkorderPdf(project) {
        const pNum = project.projectNumber;
        const pType = project.projectType === 'outdoor_kitchen' ? 'Exclusieve Buitenkeuken' : 'Luxe Tuinkamer / Bijgebouw';
        const city = this.escapePdfText(project.city);
        const address = this.escapePdfText(project.deliveryAddress);
        const postalCode = this.escapePdfText(project.postalCode || '1000 AA');
        const partnerName = this.escapePdfText(project.partnerName || 'Vakman / Meubelmaker');
        const orderStatus = this.escapePdfText(project.orderStatus || 'In voorbereiding');
        const dims = this.escapePdfText(project.statusTexts?.leverweek || 'Week n.t.b.');
        const agreedFee = project.agreedBuildPrice != null ? `EUR ${project.agreedBuildPrice.toFixed(2)}` : 'Overeenkomstig contract';
        const pageContent = `
0.1 0.15 0.12 rg
0 740 595 102 re f
1 1 1 rg
BT /F1 22 Tf 40 795 Td (WERKORDER TECHNISCHE REALISATIE) Tj ET
0.75 0.65 0.45 rg
BT /F1 11 Tf 40 770 Td (VANUIT AMBACHT - MEUBELMAKERIJ & PREFABRICAGE) Tj ET
1 1 1 rg
BT /F1 10 Tf 420 795 Td (Ordernummer: ${this.escapePdfText(pNum)}) Tj ET
BT /F1 9 Tf 420 780 Td (Status: ${orderStatus}) Tj ET

0.95 0.95 0.95 rg 40 610 515 100 re f
0.7 0.7 0.7 RG 1 w 40 610 515 100 re s
0.1 0.1 0.1 rg
BT /F1 12 Tf 55 690 Td (1. PROJECTGEGEVENS & LOCATIE) Tj ET
BT /F1 10 Tf 55 670 Td (Type constructie: ${this.escapePdfText(pType)}) Tj ET
BT /F1 10 Tf 55 655 Td (Afleverlocatie: ${address}, ${postalCode} ${city}) Tj ET
BT /F1 10 Tf 55 640 Td (Geplande levering / montage: ${dims}) Tj ET
BT /F1 10 Tf 55 625 Td (Toegewezen vakman: ${partnerName}) Tj ET

0.95 0.95 0.95 rg 40 450 515 140 re f
0.7 0.7 0.7 RG 1 w 40 450 515 140 re s
0.1 0.1 0.1 rg
BT /F1 12 Tf 55 570 Td (2. TECHNISCHE SPECIFICATIES & HOUTSELECTIE) Tj ET
BT /F1 9 Tf 55 550 Td (- Houtsoort: Thermo Frake / Zwart gebeitst vurenhout geventileerd verwerkt) Tj ET
BT /F1 9 Tf 55 535 Td (- Bevestigingen: RVS A2 bolkop- en spaanplaatschroeven) Tj ET
BT /F1 9 Tf 55 520 Td (- Werkblad uitsparing: Kamado / BBQ conform CAD werktekening specificatie) Tj ET
BT /F1 9 Tf 55 505 Td (- Scharnieren: Softclose buitenbestendige Blum / Hettich zwart beslag) Tj ET
BT /F1 9 Tf 55 490 Td (- Ventilatie: Minimale onderlinge lat-afstand 6mm conform voorschrift) Tj ET
BT /F1 9 Tf 55 470 Td (- Afgesproken bouwvergoeding: ${agreedFee}) Tj ET

0.95 0.95 0.95 rg 40 310 515 120 re f
0.7 0.7 0.7 RG 1 w 40 310 515 120 re s
0.1 0.1 0.1 rg
BT /F1 12 Tf 55 410 Td (3. KWALITEITSCONTROLE VOOR TRANSPORT) Tj ET
BT /F1 9 Tf 55 390 Td ([ ] Zaagwerk en verstekken haaks en splintervrij nagekeken) Tj ET
BT /F1 9 Tf 55 375 Td ([ ] Dubbele impregneer-/oliebehandeling egaal aangebracht en uitgehard) Tj ET
BT /F1 9 Tf 55 360 Td ([ ] Deuren en ladegeleiders afgesteld op gelijke speling (3mm rondom)) Tj ET
BT /F1 9 Tf 55 345 Td ([ ] Werkplaats-voormontage gefotografeerd voor opleverdossier) Tj ET
BT /F1 9 Tf 55 330 Td ([ ] Veilig verpakt en waterdicht beschermd voor transport) Tj ET

0.95 0.95 0.95 rg 40 180 515 110 re f
0.7 0.7 0.7 RG 1 w 40 180 515 110 re s
0.1 0.1 0.1 rg
BT /F1 12 Tf 55 270 Td (4. VEILIGHEID & INSTRUCTIES VOOR MONTAGE OP LOCATIE) Tj ET
BT /F1 9 Tf 55 250 Td (Neem bij afwijkingen direct contact op met de projectleider via WhatsApp.) Tj ET
BT /F1 9 Tf 55 235 Td (Controleer voor lossen altijd de doorgang en ondergrond.) Tj ET
BT /F1 9 Tf 55 220 Td (Gebruik bij montage uitsluitend bijgeleverde rubberen stelvoeten of tegeldragers.) Tj ET
BT /F1 9 Tf 55 195 Td (Opleverrapport dient ter plekke samen met de klant digitaal te worden afgetekend.) Tj ET

0.8 0.8 0.8 RG 1 w 40 120 515 0 re s
0.4 0.4 0.4 rg
BT /F1 8 Tf 40 100 Td (Document strikt vertrouwelijk - Uitsluitend bestemd voor geautoriseerde vakmannen.) Tj ET
BT /F1 8 Tf 40 88 Td (Vanuit Ambacht B.V. - Industrieweg 14, 5104 RA Dongen - info@vanuitambacht.nl) Tj ET
`;
        const buffer = this.createPdfDocument([pageContent]);
        return {
            buffer,
            fileName: `Werkorder_${pNum}.pdf`,
        };
    }
    /**
     * Generate Opleverrapport PDF for project handover
     */
    generateOpleverrapportPdf(project, oplevering) {
        const pNum = project.projectNumber;
        const custName = this.escapePdfText(project.customerName || 'Opdrachtgever');
        const address = this.escapePdfText(project.deliveryAddress);
        const city = this.escapePdfText(project.city);
        const pType = project.projectType === 'outdoor_kitchen' ? 'Exclusieve Buitenkeuken' : 'Luxe Tuinkamer';
        const signee = this.escapePdfText(oplevering.signeeName);
        const dateStr = this.escapePdfText(oplevering.completedAt.split('T')[0]);
        // Checklist format
        const checkItems = Object.entries(oplevering.checklist || {})
            .map(([key, val]) => `[${val ? 'X' : ' '}] ${this.escapePdfText(key)}`)
            .slice(0, 6);
        const checkLines = checkItems
            .map((item, idx) => `BT /F1 9 Tf 55 ${430 - idx * 16} Td (${item}) Tj ET`)
            .join('\n');
        const pageContent = `
0.15 0.2 0.15 rg
0 740 595 102 re f
1 1 1 rg
BT /F1 22 Tf 40 795 Td (OFFICIEEL OPLEVERRAPPORT) Tj ET
0.75 0.65 0.45 rg
BT /F1 11 Tf 40 770 Td (DEFINITIEVE OVERDRACHT & KWALITEITSCERTIFICAAT) Tj ET
1 1 1 rg
BT /F1 10 Tf 420 795 Td (Project: ${this.escapePdfText(pNum)}) Tj ET
BT /F1 9 Tf 420 780 Td (Datum: ${dateStr}) Tj ET

0.95 0.95 0.95 rg 40 600 515 110 re f
0.7 0.7 0.7 RG 1 w 40 600 515 110 re s
0.1 0.1 0.1 rg
BT /F1 12 Tf 55 685 Td (1. PROJECT- & KLANTGEGEVENS) Tj ET
BT /F1 10 Tf 55 665 Td (Opdrachtgever: Fam. ${custName}) Tj ET
BT /F1 10 Tf 55 650 Td (Projectomschrijving: ${this.escapePdfText(pType)}) Tj ET
BT /F1 10 Tf 55 635 Td (Opleveradres: ${address}, ${city}) Tj ET
BT /F1 10 Tf 55 620 Td (Uitvoerder: Vanuit Ambacht Montage & Realisatie) Tj ET

0.95 0.95 0.95 rg 40 330 515 250 re f
0.7 0.7 0.7 RG 1 w 40 330 515 250 re s
0.1 0.1 0.1 rg
BT /F1 12 Tf 55 555 Td (2. OPLEVERING & PUNCHLIST INSPECTIE) Tj ET
BT /F1 9 Tf 55 535 Td (De onderstaande onderdelen zijn gezamenlijk geinspecteerd en in goede staat bevonden:) Tj ET
BT /F1 9 Tf 55 510 Td ([X] Constructie stabiel, waterpas en deugdelijk verankerd geplaatst) Tj ET
BT /F1 9 Tf 55 490 Td ([X] Houtwerk onbeschadigd, behandeld en splintervrij afgewerkt) Tj ET
BT /F1 9 Tf 55 470 Td ([X] Apparatuur / barbecue passing en toebehoren getest en werkend) Tj ET
BT /F1 9 Tf 55 450 Td ([X] Hang- en sluitwerk soepel afgesteld en sluitend) Tj ET
${checkLines}

0.95 0.95 0.95 rg 40 140 515 170 re f
0.7 0.7 0.7 RG 1 w 40 140 515 170 re s
0.1 0.1 0.1 rg
BT /F1 12 Tf 55 285 Td (3. AKKOORDVERKLARING & DIGITALE ONDERTEKENING) Tj ET
BT /F1 9 Tf 55 265 Td (Ondergetekende verklaart hierbij het bovenstaande project in goede orde en volgens afspraak) Tj ET
BT /F1 9 Tf 55 250 Td (te hebben ontvangen en goedgekeurd.) Tj ET
BT /F1 10 Tf 55 220 Td (Ondertekend door: ${signee}) Tj ET
BT /F1 9 Tf 55 205 Td (Tijdstip verificatie: ${this.escapePdfText(oplevering.completedAt)}) Tj ET

0.2 0.5 0.3 RG 1.5 w 55 175 140 0 re s
0.2 0.5 0.3 rg
BT /F1 10 Tf 55 180 Td ([ DIGITAAL GOEDGEKEURD & ONDERTEKEND ]) Tj ET

0.8 0.8 0.8 RG 1 w 40 100 515 0 re s
0.4 0.4 0.4 rg
BT /F1 8 Tf 40 85 Td (Garantie: 5 jaar constructiegarantie conform leveringsvoorwaarden Vanuit Ambacht B.V.) Tj ET
BT /F1 8 Tf 40 73 Td (Vragen of nazorg? WhatsApp onze servicebalie of mail service@vanuitambacht.nl) Tj ET
`;
        const buffer = this.createPdfDocument([pageContent]);
        return {
            buffer,
            fileName: `Opleverrapport_${pNum}.pdf`,
        };
    }
}
export const projectPdfService = new ProjectPdfService();
