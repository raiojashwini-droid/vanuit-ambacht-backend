import { eq, and, or, ilike, sql, desc, asc, inArray } from 'drizzle-orm';
import crypto from 'node:crypto';
import { db } from '../../db/index.js';
import {
  quotes,
  quoteVersions,
  quoteItems,
  customers,
  leads,
  partnerOffers,
  projects,
  invoices,
  invoiceItems,
  commercialActions,
  documents,
  users,
  companySettings,
} from '../../db/schema.js';
import type {
  CreateQuoteInput,
  UpdateQuoteInput,
  SaveDraftVersionInput,
  PublishQuoteInput,
  ApproveOfferteInput,
  RejectOfferteInput,
  QuoteQueryInput,
} from './quote.schema.js';
import type {
  QuoteDto,
  QuoteVersionDto,
  QuoteItemDto,
  PublicOfferteDto,
  QuoteListResponse,
  InstalmentDto,
  InstalmentsConfig,
  LetterConfig,
} from './quote.types.js';
import { quotePdfService } from './quote-pdf.service.js';
import type { JwtTokenPayload } from '../../types/auth.types.js';

export class QuoteError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 400, code = 'QUOTE_ERROR') {
    super(message);
    this.name = 'QuoteError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class QuoteService {
  /**
   * Generates unique sequential quote number based on company settings prefix
   */
  async generateQuoteNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const [comp] = await db.select({ quotePrefix: companySettings.quotePrefix }).from(companySettings).limit(1);
    let rawPrefix = comp?.quotePrefix?.trim() || `OF-${year}`;
    rawPrefix = rawPrefix.replace(/^#/, '');
    const prefix = rawPrefix.endsWith('-') ? rawPrefix : `${rawPrefix}-`;

    const [latest] = await db
      .select({ quoteNumber: quotes.quoteNumber })
      .from(quotes)
      .where(ilike(quotes.quoteNumber, `${prefix}%`))
      .orderBy(desc(quotes.quoteNumber))
      .limit(1);

    if (!latest) {
      return `${prefix}001`;
    }

    const currentNumber = parseInt(latest.quoteNumber.replace(prefix, ''), 10);
    const nextSeq = isNaN(currentNumber) ? 1 : currentNumber + 1;
    return `${prefix}${nextSeq.toString().padStart(3, '0')}`;
  }

  /**
   * Generates unique sequential project number: PRJ-YYYY-XXX
   */
  async generateProjectNumber(offset: number = 0, executor: any = db): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `PRJ-${year}-`;

    const [latest] = await executor
      .select({ projectNumber: projects.projectNumber })
      .from(projects)
      .where(ilike(projects.projectNumber, `${prefix}%`))
      .orderBy(desc(projects.projectNumber))
      .limit(1);

    const baseSeq = latest ? parseInt(latest.projectNumber.replace(prefix, ''), 10) || 0 : 0;
    const nextSeq = baseSeq + 1 + offset;
    return `${prefix}${nextSeq.toString().padStart(3, '0')}`;
  }

  /**
   * Generates unique sequential invoice number based on company settings prefix
   */
  async generateInvoiceNumber(offset: number = 0, executor: any = db): Promise<string> {
    const year = new Date().getFullYear();
    const [comp] = await executor.select({ invoicePrefix: companySettings.invoicePrefix }).from(companySettings).limit(1);
    let rawPrefix = comp?.invoicePrefix?.trim() || `INV-${year}`;
    rawPrefix = rawPrefix.replace(/^#/, '');
    const prefix = rawPrefix.endsWith('-') ? rawPrefix : `${rawPrefix}-`;

    const [latest] = await executor
      .select({ invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .where(ilike(invoices.invoiceNumber, `${prefix}%`))
      .orderBy(desc(invoices.invoiceNumber))
      .limit(1);

    const baseSeq = latest ? parseInt(latest.invoiceNumber.replace(prefix, ''), 10) || 0 : 0;
    const nextSeq = baseSeq + 1 + offset;
    return `${prefix}${nextSeq.toString().padStart(3, '0')}`;
  }

  /**
   * Generates a 64-character crypto-random public token
   */
  generatePublicToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Rigorous server-side financial recalculation engine
   */
  recalculateTotals(rawItems: any[]) {
    let subtotalExclVat = 0;
    let vatAmount = 0;
    let totalInclVat = 0;

    const processedItems = rawItems.map((item, index) => {
      const position = item.position || index + 1;
      const quantity = Math.max(0.01, Number(item.quantity) || 1);
      const isIncluded = Boolean(item.isIncluded);
      const isStelpost = Boolean(item.isStelpost);
      const vatRate = Number(item.vatRate) >= 0 ? Number(item.vatRate) : 21.0;
      const priceInclVat = Number(item.priceInclVat) || 0;

      let lineTotalInclVat = 0;
      let lineTotalExclVat = 0;
      let lineVat = 0;

      if (!isIncluded) {
        lineTotalInclVat = Math.round(quantity * priceInclVat * 100) / 100;
        lineTotalExclVat = Math.round((lineTotalInclVat / (1 + vatRate / 100)) * 100) / 100;
        lineVat = Math.round((lineTotalInclVat - lineTotalExclVat) * 100) / 100;

        totalInclVat += lineTotalInclVat;
        subtotalExclVat += lineTotalExclVat;
        vatAmount += lineVat;
      }

      return {
        id: item.id,
        position,
        title: item.title,
        description: item.description || null,
        quantity,
        unitPriceInclVat: priceInclVat,
        vatRate,
        lineTotalInclVat,
        isIncluded,
        isStelpost,
      };
    });

    return {
      subtotalExclVat: Math.round(subtotalExclVat * 100) / 100,
      vatAmount: Math.round(vatAmount * 100) / 100,
      totalInclVat: Math.round(totalInclVat * 100) / 100,
      processedItems,
    };
  }

  /**
   * Recalculate payment instalments with remainder allocated to the final instalment
   */
  calculateInstalments(totalInclVat: number, count = 2, percentages?: number[], customLabels?: string[]): InstalmentDto[] {
    const validCount = Math.min(3, Math.max(2, count));
    const defaultP = validCount === 3 ? [40, 40, 20] : [50, 50];
    const rawP = (percentages && percentages.length >= validCount) ? percentages : defaultP;
    const p = rawP.slice(0, validCount);
    let accumulated = 0;

    return p.map((pct, idx) => {
      const defaultLabel = idx === 0 ? 'Bij akkoord' : validCount === 3 && idx === 1 ? 'Bij start bouw' : 'Bij levering';
      const label = customLabels && customLabels[idx] ? customLabels[idx] : defaultLabel;

      if (idx === p.length - 1) {
        const remainder = Math.round((totalInclVat - accumulated) * 100) / 100;
        return {
          step: idx + 1,
          percentage: pct,
          label,
          amount: remainder,
        };
      }

      const amt = Math.round(totalInclVat * (pct / 100) * 100) / 100;
      accumulated += amt;
      return {
        step: idx + 1,
        percentage: pct,
        label,
        amount: amt,
      };
    });
  }

  /**
   * Map database quote record to QuoteDto
   */
  private mapQuoteToDto(
    quote: any,
    extra?: {
      customer?: any;
      lead?: any;
      activeVersion?: QuoteVersionDto | null;
      versions?: QuoteVersionDto[];
    }
  ): QuoteDto {
    const today = new Date().toISOString().split('T')[0];
    const isExpired = quote.validUntil ? quote.validUntil < today : false;
    const c = extra?.customer;
    const l = extra?.lead;

    const customerName = c
      ? `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.companyName
      : l
      ? l.name
      : null;

    return {
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      publicToken: quote.publicToken,
      publicUrl: `https://vanuitambacht.nl/offerte/${quote.publicToken}`,
      leadId: quote.leadId,
      customerId: quote.customerId,
      customerName,
      customerEmail: c?.email || l?.email || null,
      customerCity: c?.city || l?.city || null,
      customerPhone: c?.phone || l?.phone || null,
      customerAddress: c?.streetAddress || l?.address || null,
      acceptedPartnerOfferId: quote.acceptedPartnerOfferId,
      status: quote.status,
      productType: quote.productType,
      issueDate: String(quote.issueDate).split('T')[0],
      validUntil: String(quote.validUntil).split('T')[0],
      sentAt: quote.sentAt ? new Date(quote.sentAt).toISOString() : null,
      isExpired,
      createdAt: quote.createdAt.toISOString(),
      updatedAt: quote.updatedAt.toISOString(),
      activeVersion: extra?.activeVersion || null,
      versions: extra?.versions || [],
    };
  }

  /**
   * Map database quote_versions record to QuoteVersionDto
   */
  private mapVersionToDto(v: any, items?: QuoteItemDto[]): QuoteVersionDto {
    return {
      id: v.id,
      quoteId: v.quoteId,
      versionNumber: v.versionNumber,
      isCurrent: v.isCurrent,
      createdByUserId: v.createdByUserId,
      coverTitleLine1: v.coverTitleLine1,
      coverTitleLine2: v.coverTitleLine2,
      customSubtitle: v.customSubtitle,
      coverPhotos: v.coverPhotos,
      dimensionsText: v.dimensionsText,
      woodType: v.woodType,
      woodLifespan: v.woodLifespan,
      optionsTitle: v.optionsTitle,
      optionsSubtext: v.optionsSubtext,
      deliveryTimeText: v.deliveryTimeText,
      deliverySubtext: v.deliverySubtext,
      costPrice: v.costPrice != null ? Number(v.costPrice) : null,
      marginPercent: v.marginPercent != null ? Number(v.marginPercent) : null,
      marginAmount: v.marginAmount != null ? Number(v.marginAmount) : null,
      subtotalExclVat: Number(v.subtotalExclVat),
      vatAmount: Number(v.vatAmount),
      totalInclVat: Number(v.totalInclVat),
      finishTreatment: v.finishTreatment,
      stelpostDisclaimer: v.stelpostDisclaimer,
      vatDisclaimer: v.vatDisclaimer,
      validityText: v.validityText,
      instalmentsConfig: v.instalmentsConfig,
      diagramConfig: v.diagramConfig,
      specificationsOverview: v.specificationsOverview,
      letterConfig: v.letterConfig,
      status: v.status,
      digitalSignature: v.digitalSignature,
      approvedAt: v.approvedAt ? new Date(v.approvedAt).toISOString() : null,
      createdAt: v.createdAt.toISOString(),
      items: items || [],
    };
  }

  /**
   * GET /api/quotes
   * Query quotes list with status counters, search, and pagination
   */
  async list(query: QuoteQueryInput, user: JwtTokenPayload): Promise<QuoteListResponse> {
    const { page, limit, status, search, sortBy, customerId, leadId } = query;
    const offset = (page - 1) * limit;

    const conditions = [];

    // Customer scoping
    if (user.role === 'customer') {
      if (!user.profileId) {
        return { items: [], total: 0, page, limit, totalPages: 0, counters: { total: 0, draft: 0, sent: 0, approved: 0, declined: 0 } };
      }
      conditions.push(eq(quotes.customerId, user.profileId));
    } else if (customerId) {
      conditions.push(eq(quotes.customerId, customerId));
    }

    if (leadId) {
      conditions.push(eq(quotes.leadId, leadId));
    }

    if (status) {
      conditions.push(eq(quotes.status, status));
    }

    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        or(
          ilike(quotes.quoteNumber, pattern),
          ilike(quotes.productType, pattern),
          ilike(customers.firstName, pattern),
          ilike(customers.lastName, pattern),
          ilike(customers.companyName, pattern),
          ilike(leads.name, pattern)
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Counters query
    const counterRows = await db
      .select({
        status: quotes.status,
        count: sql<number>`count(*)::int`,
      })
      .from(quotes)
      .groupBy(quotes.status);

    const counters = {
      total: 0,
      draft: 0,
      sent: 0,
      approved: 0,
      declined: 0,
    };

    for (const r of counterRows) {
      counters.total += r.count;
      if (r.status === 'draft') counters.draft = r.count;
      if (r.status === 'sent') counters.sent = r.count;
      if (r.status === 'approved') counters.approved = r.count;
      if (r.status === 'declined') counters.declined = r.count;
    }

    // Total filtered count
    const [countRes] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(quotes)
      .leftJoin(customers, eq(quotes.customerId, customers.id))
      .leftJoin(leads, eq(quotes.leadId, leads.id))
      .where(whereClause);

    const total = countRes?.count || 0;
    const totalPages = Math.ceil(total / limit);

    if (total === 0) {
      return { items: [], total: 0, page, limit, totalPages: 0, counters };
    }

    // Sorting
    let orderByClause = desc(quotes.createdAt);
    if (sortBy === 'oldest') orderByClause = asc(quotes.createdAt);

    const rows = await db
      .select({
        quote: quotes,
        customer: customers,
        lead: leads,
      })
      .from(quotes)
      .leftJoin(customers, eq(quotes.customerId, customers.id))
      .leftJoin(leads, eq(quotes.leadId, leads.id))
      .where(whereClause)
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);

    // Batch load current active versions for these quotes
    const quoteIds = rows.map((r) => r.quote.id);
    const activeVersions = await db
      .select()
      .from(quoteVersions)
      .where(and(inArray(quoteVersions.quoteId, quoteIds), eq(quoteVersions.isCurrent, true)));

    const activeVersionMap: Record<string, QuoteVersionDto> = {};
    for (const v of activeVersions) {
      activeVersionMap[v.quoteId] = this.mapVersionToDto(v);
    }

    const items: QuoteDto[] = rows.map(({ quote, customer, lead }) => {
      return this.mapQuoteToDto(quote, {
        customer,
        lead,
        activeVersion: activeVersionMap[quote.id] || null,
      });
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages,
      counters,
    };
  }

  /**
   * Helper to resolve a quote record by UUID or human-readable quoteNumber (e.g. Q-2026-003)
   */
  async findQuoteRecord(idOrNumber: string) {
    if (!idOrNumber || typeof idOrNumber !== 'string') return null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrNumber.trim());
    const [quote] = await db
      .select()
      .from(quotes)
      .where(isUuid ? eq(quotes.id, idOrNumber.trim()) : eq(quotes.quoteNumber, idOrNumber.trim()))
      .limit(1);
    return quote || null;
  }

  /**
   * GET /api/quotes/:id
   * Complete Quote Dossier with all versions & line items (supports UUID or QuoteNumber)
   */
  async getById(id: string, user: JwtTokenPayload): Promise<QuoteDto> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());
    const [row] = await db
      .select({
        quote: quotes,
        customer: customers,
        lead: leads,
      })
      .from(quotes)
      .leftJoin(customers, eq(quotes.customerId, customers.id))
      .leftJoin(leads, eq(quotes.leadId, leads.id))
      .where(isUuid ? eq(quotes.id, id.trim()) : eq(quotes.quoteNumber, id.trim()))
      .limit(1);

    if (!row) {
      throw new QuoteError('Quote not found', 404, 'NOT_FOUND');
    }

    const realQuoteId = row.quote.id;

    // Customer security check
    if (user.role === 'customer' && row.quote.customerId !== user.profileId) {
      throw new QuoteError('You are not authorized to view this quote', 403, 'FORBIDDEN');
    }

    // Load all versions
    const rawVersions = await db
      .select()
      .from(quoteVersions)
      .where(eq(quoteVersions.quoteId, realQuoteId))
      .orderBy(desc(quoteVersions.versionNumber));

    // Load line items for all versions
    const versionIds = rawVersions.map((v) => v.id);
    const rawItems = versionIds.length > 0
      ? await db
          .select()
          .from(quoteItems)
          .where(inArray(quoteItems.quoteVersionId, versionIds))
          .orderBy(asc(quoteItems.position))
      : [];

    const itemsByVersion: Record<string, QuoteItemDto[]> = {};
    for (const it of rawItems) {
      if (!itemsByVersion[it.quoteVersionId]) itemsByVersion[it.quoteVersionId] = [];
      itemsByVersion[it.quoteVersionId].push({
        id: it.id,
        position: it.position,
        title: it.title,
        description: it.description,
        quantity: Number(it.quantity),
        unitPriceInclVat: Number(it.unitPriceInclVat),
        vatRate: Number(it.vatRate),
        lineTotalInclVat: Number(it.lineTotalInclVat),
        isIncluded: it.isIncluded,
        isStelpost: it.isStelpost,
      });
    }

    const versions: QuoteVersionDto[] = rawVersions.map((v) => this.mapVersionToDto(v, itemsByVersion[v.id]));
    const activeVersion = versions.find((v) => v.isCurrent) || versions[0] || null;

    return this.mapQuoteToDto(row.quote, {
      customer: row.customer,
      lead: row.lead,
      activeVersion,
      versions,
    });
  }

  /**
   * POST /api/quotes
   * Admin initializes quote draft (atomic transaction)
   */
  async create(input: CreateQuoteInput, adminUserId: string): Promise<QuoteDto> {
    const today = new Date().toISOString().split('T')[0];
    const defaultValidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const issueDate = input.issueDate || today;
    const validUntil = input.validUntil || defaultValidUntil;

    let leadRecord = null;
    if (input.leadId) {
      [leadRecord] = await db.select().from(leads).where(eq(leads.id, input.leadId)).limit(1);
    }

    return await db.transaction(async (tx) => {
      const quoteNumber = await this.generateQuoteNumber();
      const publicToken = this.generatePublicToken();

      const [newQuote] = await tx
        .insert(quotes)
        .values({
          quoteNumber,
          publicToken,
          leadId: input.leadId || null,
          customerId: input.customerId || leadRecord?.customerId || null,
          acceptedPartnerOfferId: input.acceptedPartnerOfferId || null,
          productType: input.productType || leadRecord?.productType || 'outdoor_kitchen',
          issueDate,
          validUntil,
          status: 'draft',
        })
        .returning();

      // Seed initial draft version 1
      const defaultItems = [
        {
          position: 1,
          title: `Maatwerk ${input.productType === 'garden_room' ? 'Buitenverblijf' : 'Buitenkeuken'}`,
          description: 'Constructie volgens goedgekeurde specificaties',
          quantity: 1,
          priceInclVat: 4950.0,
          vatRate: 21.0,
          isIncluded: false,
          isStelpost: false,
        },
        {
          position: 2,
          title: 'Levering en professionele plaatsing',
          description: 'Op locatie in overleg ingepland',
          quantity: 1,
          priceInclVat: 0.0,
          vatRate: 21.0,
          isIncluded: true,
          isStelpost: false,
        },
      ];

      const totals = this.recalculateTotals(defaultItems);

      const [v1] = await tx
        .insert(quoteVersions)
        .values({
          quoteId: newQuote.id,
          versionNumber: 1,
          isCurrent: true,
          createdByUserId: adminUserId,
          coverTitleLine1: 'EEN MAATWERK MEUBEL',
          coverTitleLine2: `VOOR ${leadRecord?.name?.toUpperCase() || 'GEWAARDEERDE KLANT'}`,
          customSubtitle: 'Exclusief vakwerk vervaardigd door Vanuit Ambacht',
          coverPhotos: ['/cover_img1.png', '/cover_img2.png', '/cover_img3.png'],
          dimensionsText: '240 x 80 cm',
          woodType: 'Thermo Frake',
          woodLifespan: '20 tot 25 jaar',
          optionsTitle: 'Kamado / BBQ integratie',
          optionsSubtext: 'Rechts van het midden',
          deliveryTimeText: '3 tot 5 weken',
          deliverySubtext: 'na technisch akkoord',
          costPrice: sql`3200.00::numeric`,
          marginPercent: sql`35.00::numeric`,
          marginAmount: sql`1120.00::numeric`,
          subtotalExclVat: sql`${totals.subtotalExclVat}::numeric`,
          vatAmount: sql`${totals.vatAmount}::numeric`,
          totalInclVat: sql`${totals.totalInclVat}::numeric`,
          finishTreatment: 'Twee-laags natuurlijke beschermende olie',
          stelpostDisclaimer: '* Stelpost: afrekening op basis van werkelijke kosten.',
          vatDisclaimer: 'Alle bedragen inclusief btw',
          validityText: `Deze offerte is geldig tot en met ${validUntil}`,
          instalmentsConfig: {
            count: 2,
            percentages: [50, 50],
            labels: ['Bij akkoord', 'Bij levering'],
            subtexts: ['Na akkoord op de technische tekening', 'Pas als alles naar wens is opgeleverd'],
          },
          status: 'draft',
        })
        .returning();

      // Insert line items for v1
      for (const it of totals.processedItems) {
        await tx.insert(quoteItems).values({
          quoteVersionId: v1.id,
          position: it.position,
          title: it.title,
          description: it.description,
          quantity: sql`${it.quantity}::numeric`,
          unitPriceInclVat: sql`${it.unitPriceInclVat}::numeric`,
          vatRate: sql`${it.vatRate}::numeric`,
          lineTotalInclVat: sql`${it.lineTotalInclVat}::numeric`,
          isIncluded: it.isIncluded,
          isStelpost: it.isStelpost,
        });
      }

      // If linked to lead: advance lead workflow to Step 4 (Build quote)
      if (input.leadId && leadRecord) {
        const nextStep = Math.max(leadRecord.workflowStep, 4);
        await tx
          .update(leads)
          .set({
            workflowStep: nextStep,
            updatedAt: new Date(),
          })
          .where(eq(leads.id, input.leadId));

        await tx.insert(commercialActions).values({
          leadId: input.leadId,
          createdByUserId: adminUserId,
          actionType: 'quote_draft_created',
          note: `Quote draft ${quoteNumber} created (Step 4: Build Quote)`,
        });
      }

      const activeVersion = this.mapVersionToDto(v1, totals.processedItems);
      return this.mapQuoteToDto(newQuote, { lead: leadRecord, activeVersion, versions: [activeVersion] });
    });
  }

  /**
   * PATCH /api/quotes/:id
   * Update top-level quote properties (dates, productType, customer)
   */
  async update(id: string, input: UpdateQuoteInput, adminUserId: string): Promise<QuoteDto> {
    const existing = await this.findQuoteRecord(id);
    if (!existing) {
      throw new QuoteError('Quote not found', 404, 'NOT_FOUND');
    }

    if (existing.status === 'approved') {
      throw new QuoteError('Cannot edit an approved quote', 400, 'QUOTE_ALREADY_APPROVED');
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (input.productType !== undefined) updateData.productType = input.productType;
    if (input.issueDate !== undefined) updateData.issueDate = input.issueDate;
    if (input.validUntil !== undefined) updateData.validUntil = input.validUntil;
    if (input.customerId !== undefined) updateData.customerId = input.customerId;
    if (input.leadId !== undefined) updateData.leadId = input.leadId;

    await db.update(quotes).set(updateData).where(eq(quotes.id, existing.id));
    return await this.getById(existing.id, { sub: adminUserId, role: 'admin', email: '', fullName: '' });
  }

  /**
   * PUT /api/quotes/:id/versions/draft
   * Continuous draft autosave: updates current draft, or spawns new revision if current version is already sent
   */
  async saveDraftVersion(quoteId: string, input: SaveDraftVersionInput, adminUserId: string): Promise<QuoteDto> {
    const quote = await this.findQuoteRecord(quoteId);
    if (!quote) {
      throw new QuoteError('Quote not found', 404, 'NOT_FOUND');
    }

    if (quote.status === 'approved') {
      throw new QuoteError('Cannot edit an approved quote', 400, 'QUOTE_ALREADY_APPROVED');
    }

    // Get current active version
    const [currentVersion] = await db
      .select()
      .from(quoteVersions)
      .where(and(eq(quoteVersions.quoteId, quote.id), eq(quoteVersions.isCurrent, true)))
      .limit(1);

    await db.transaction(async (tx) => {
      let targetVersionId = currentVersion?.id;

      // If current version was already 'sent', archiving prior version and creating new draft revision
      if (currentVersion && currentVersion.status === 'sent') {
        await tx
          .update(quoteVersions)
          .set({ isCurrent: false, status: 'superseded' })
          .where(eq(quoteVersions.id, currentVersion.id));

        const nextVersionNum = currentVersion.versionNumber + 1;
        const [newDraftV] = await tx
          .insert(quoteVersions)
          .values({
            quoteId: quote.id,
            versionNumber: nextVersionNum,
            isCurrent: true,
            createdByUserId: adminUserId,
            status: 'draft',
            subtotalExclVat: sql`0::numeric`,
            vatAmount: sql`0::numeric`,
            totalInclVat: sql`0::numeric`,
          })
          .returning();

        targetVersionId = newDraftV.id;
      }

      // Recalculate financial totals from line items (preserve existing items if partial update)
      const hasLineItemsInput = input.lineItems !== undefined || (input as any).items !== undefined;
      let rawLineItems: any[] = [];

      if (hasLineItemsInput) {
        rawLineItems = input.lineItems || (input as any).items || [];
      } else {
        const existingItems = await tx
          .select()
          .from(quoteItems)
          .where(eq(quoteItems.quoteVersionId, currentVersion.id))
          .orderBy(quoteItems.position);
        rawLineItems = existingItems.map((it) => ({
          id: it.id,
          position: it.position,
          title: it.title,
          description: it.description,
          quantity: Number(it.quantity),
          priceInclVat: Number(it.unitPriceInclVat),
          vatRate: Number(it.vatRate),
          isIncluded: it.isIncluded,
          isStelpost: it.isStelpost,
        }));
      }

      const totals = this.recalculateTotals(rawLineItems);

      // Handle margin calculations
      let costPrice = input.costPrice != null ? input.costPrice : currentVersion?.costPrice ? Number(currentVersion.costPrice) : null;
      let marginPercent = input.marginPercent != null ? input.marginPercent : currentVersion?.marginPercent ? Number(currentVersion.marginPercent) : 35.0;
      let marginAmount = input.marginAmount != null ? input.marginAmount : null;

      if (costPrice != null && costPrice > 0) {
        if (marginAmount != null) {
          marginPercent = Math.round((marginAmount / costPrice) * 10000) / 100;
        } else if (totals.subtotalExclVat >= costPrice) {
          marginAmount = Math.round((totals.subtotalExclVat - costPrice) * 100) / 100;
          marginPercent = Math.round((marginAmount / costPrice) * 10000) / 100;
        } else if (marginPercent != null) {
          marginAmount = Math.round(costPrice * (marginPercent / 100) * 100) / 100;
        }
      }

      // Update version record
      const updateVersionData: Record<string, any> = {
        coverTitleLine1: input.coverTitleLine1 !== undefined ? input.coverTitleLine1 : currentVersion?.coverTitleLine1,
        coverTitleLine2: input.coverTitleLine2 !== undefined ? input.coverTitleLine2 : currentVersion?.coverTitleLine2,
        customSubtitle: input.customSubtitle !== undefined ? input.customSubtitle : currentVersion?.customSubtitle,
        coverPhotos: input.coverPhotos !== undefined ? input.coverPhotos : currentVersion?.coverPhotos,
        dimensionsText: input.dimensionsText !== undefined ? input.dimensionsText : currentVersion?.dimensionsText,
        woodType: input.woodType !== undefined ? input.woodType : currentVersion?.woodType,
        woodLifespan: input.woodLifespan !== undefined ? input.woodLifespan : currentVersion?.woodLifespan,
        optionsTitle: input.optionsTitle !== undefined ? input.optionsTitle : currentVersion?.optionsTitle,
        optionsSubtext: input.optionsSubtext !== undefined ? input.optionsSubtext : currentVersion?.optionsSubtext,
        deliveryTimeText: input.deliveryTimeText !== undefined ? input.deliveryTimeText : currentVersion?.deliveryTimeText,
        deliverySubtext: input.deliverySubtext !== undefined ? input.deliverySubtext : currentVersion?.deliverySubtext,
        costPrice: costPrice != null ? sql`${costPrice}::numeric` : null,
        marginPercent: marginPercent != null ? sql`${marginPercent}::numeric` : null,
        marginAmount: marginAmount != null ? sql`${marginAmount}::numeric` : null,
        subtotalExclVat: sql`${totals.subtotalExclVat}::numeric`,
        vatAmount: sql`${totals.vatAmount}::numeric`,
        totalInclVat: sql`${totals.totalInclVat}::numeric`,
        finishTreatment: input.finishTreatment !== undefined ? input.finishTreatment : currentVersion?.finishTreatment,
        stelpostDisclaimer: input.stelpostDisclaimer !== undefined ? input.stelpostDisclaimer : currentVersion?.stelpostDisclaimer,
        vatDisclaimer: input.vatDisclaimer !== undefined ? input.vatDisclaimer : currentVersion?.vatDisclaimer,
        validityText: input.validityText !== undefined ? input.validityText : currentVersion?.validityText,
        instalmentsConfig: input.instalmentsConfig !== undefined ? input.instalmentsConfig : currentVersion?.instalmentsConfig,
        diagramConfig: input.diagramConfig !== undefined ? input.diagramConfig : currentVersion?.diagramConfig,
        specificationsOverview: input.specificationsOverview !== undefined ? input.specificationsOverview : currentVersion?.specificationsOverview,
        letterConfig: input.letterConfig !== undefined ? input.letterConfig : currentVersion?.letterConfig,
      };

      await tx.update(quoteVersions).set(updateVersionData).where(eq(quoteVersions.id, targetVersionId!));

      // Replace line items only if provided, or if new draft was cloned
      if (hasLineItemsInput || targetVersionId !== currentVersion.id) {
        await tx.delete(quoteItems).where(eq(quoteItems.quoteVersionId, targetVersionId!));
        for (const it of totals.processedItems) {
          await tx.insert(quoteItems).values({
            quoteVersionId: targetVersionId!,
            position: it.position,
            title: it.title,
            description: it.description,
            quantity: sql`${it.quantity}::numeric`,
            unitPriceInclVat: sql`${it.unitPriceInclVat}::numeric`,
            vatRate: sql`${it.vatRate}::numeric`,
            lineTotalInclVat: sql`${it.lineTotalInclVat}::numeric`,
            isIncluded: it.isIncluded,
            isStelpost: it.isStelpost,
          });
        }
      }

      // Update quote timestamp
      await tx.update(quotes).set({ updatedAt: new Date() }).where(eq(quotes.id, quote.id));
    });

    return await this.getById(quote.id, { sub: adminUserId, role: 'admin', email: '', fullName: '' });
  }

  /**
   * POST /api/quotes/:id/publish
   * Publish & send official quote proposal (atomic transaction - supports UUID or quoteNumber)
   */
  async publish(quoteId: string, input: PublishQuoteInput, adminUserId: string): Promise<QuoteDto> {
    const quote = await this.findQuoteRecord(quoteId);
    if (!quote) {
      throw new QuoteError('Quote not found', 404, 'NOT_FOUND');
    }

    if (quote.status === 'approved') {
      throw new QuoteError('Cannot publish an already approved quote', 400, 'QUOTE_ALREADY_APPROVED');
    }

    const [currentVersion] = await db
      .select()
      .from(quoteVersions)
      .where(and(eq(quoteVersions.quoteId, quote.id), eq(quoteVersions.isCurrent, true)))
      .limit(1);

    if (!currentVersion) {
      throw new QuoteError('No active version found to publish', 400, 'NO_ACTIVE_VERSION');
    }

    await db.transaction(async (tx) => {
      // Lock version as 'sent'
      await tx
        .update(quoteVersions)
        .set({ status: 'sent' })
        .where(eq(quoteVersions.id, currentVersion.id));

      // Update quote status to 'sent' and record sentAt
      await tx
        .update(quotes)
        .set({
          status: 'sent',
          sentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(quotes.id, quote.id));

      // Advance linked lead to Step 5 (Review & send)
      if (quote.leadId) {
        const [lead] = await tx.select().from(leads).where(eq(leads.id, quote.leadId)).limit(1);
        if (lead) {
          const nextStep = Math.max(lead.workflowStep, 5);
          await tx
            .update(leads)
            .set({
              workflowStep: nextStep,
              status: 'quote_sent',
              updatedAt: new Date(),
            })
            .where(eq(leads.id, quote.leadId));

          await tx.insert(commercialActions).values({
            leadId: quote.leadId,
            createdByUserId: adminUserId,
            actionType: 'quote_sent',
            note: `Official quote ${quote.quoteNumber} (v${currentVersion.versionNumber}) published & sent. Total: €${Number(currentVersion.totalInclVat).toFixed(2)}`,
          });
        }
      }
    });

    return await this.getById(quote.id, { sub: adminUserId, role: 'admin', email: '', fullName: '' });
  }

  /**
   * POST /api/quotes/:id/duplicate
   * Clone quote into new independent OF-YYYY-XXX draft (atomic transaction)
   */
  async duplicate(quoteId: string, adminUserId: string): Promise<QuoteDto> {
    const existing = await this.getById(quoteId, { sub: adminUserId, role: 'admin', email: '', fullName: '' });
    const currentV = existing.activeVersion;

    if (!currentV) {
      throw new QuoteError('Source quote has no version to duplicate', 400, 'NO_VERSION');
    }

    return await db.transaction(async (tx) => {
      const quoteNumber = await this.generateQuoteNumber();
      const publicToken = this.generatePublicToken();
      const today = new Date().toISOString().split('T')[0];
      const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const [clonedQuote] = await tx
        .insert(quotes)
        .values({
          quoteNumber,
          publicToken,
          leadId: existing.leadId,
          customerId: existing.customerId,
          acceptedPartnerOfferId: existing.acceptedPartnerOfferId,
          productType: existing.productType,
          issueDate: today,
          validUntil,
          status: 'draft',
        })
        .returning();

      const [clonedVersion] = await tx
        .insert(quoteVersions)
        .values({
          quoteId: clonedQuote.id,
          versionNumber: 1,
          isCurrent: true,
          createdByUserId: adminUserId,
          coverTitleLine1: currentV.coverTitleLine1,
          coverTitleLine2: currentV.coverTitleLine2,
          customSubtitle: currentV.customSubtitle,
          coverPhotos: currentV.coverPhotos,
          dimensionsText: currentV.dimensionsText,
          woodType: currentV.woodType,
          woodLifespan: currentV.woodLifespan,
          optionsTitle: currentV.optionsTitle,
          optionsSubtext: currentV.optionsSubtext,
          deliveryTimeText: currentV.deliveryTimeText,
          deliverySubtext: currentV.deliverySubtext,
          costPrice: currentV.costPrice != null ? sql`${currentV.costPrice}::numeric` : null,
          marginPercent: currentV.marginPercent != null ? sql`${currentV.marginPercent}::numeric` : null,
          marginAmount: currentV.marginAmount != null ? sql`${currentV.marginAmount}::numeric` : null,
          subtotalExclVat: sql`${currentV.subtotalExclVat}::numeric`,
          vatAmount: sql`${currentV.vatAmount}::numeric`,
          totalInclVat: sql`${currentV.totalInclVat}::numeric`,
          finishTreatment: currentV.finishTreatment,
          stelpostDisclaimer: currentV.stelpostDisclaimer,
          vatDisclaimer: currentV.vatDisclaimer,
          validityText: `Deze offerte is geldig tot en met ${validUntil}`,
          instalmentsConfig: currentV.instalmentsConfig,
          diagramConfig: currentV.diagramConfig,
          specificationsOverview: currentV.specificationsOverview,
          letterConfig: currentV.letterConfig,
          status: 'draft',
        })
        .returning();

      if (currentV.items && currentV.items.length > 0) {
        for (const it of currentV.items) {
          await tx.insert(quoteItems).values({
            quoteVersionId: clonedVersion.id,
            position: it.position,
            title: it.title,
            description: it.description,
            quantity: sql`${it.quantity}::numeric`,
            unitPriceInclVat: sql`${it.unitPriceInclVat}::numeric`,
            vatRate: sql`${it.vatRate}::numeric`,
            lineTotalInclVat: sql`${it.lineTotalInclVat}::numeric`,
            isIncluded: it.isIncluded,
            isStelpost: it.isStelpost,
          });
        }
      }

      const activeVersion = this.mapVersionToDto(clonedVersion, currentV.items);
      return this.mapQuoteToDto(clonedQuote, { activeVersion, versions: [activeVersion] });
    });
  }

  /**
   * DELETE /api/quotes/:id
   * Cascading quote deletion
   */
  async delete(quoteId: string, adminUserId: string): Promise<void> {
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
    if (!quote) {
      throw new QuoteError('Quote not found', 404, 'NOT_FOUND');
    }

    if (quote.status === 'approved') {
      throw new QuoteError('Cannot delete an approved quote with active project associations', 400, 'QUOTE_ALREADY_APPROVED');
    }

    await db.transaction(async (tx) => {
      // Find all versions
      const versions = await tx.select({ id: quoteVersions.id }).from(quoteVersions).where(eq(quoteVersions.quoteId, quoteId));
      const vIds = versions.map((v) => v.id);

      if (vIds.length > 0) {
        await tx.delete(quoteItems).where(inArray(quoteItems.quoteVersionId, vIds));
        await tx.delete(quoteVersions).where(eq(quoteVersions.quoteId, quoteId));
      }

      await tx.delete(quotes).where(eq(quotes.id, quoteId));
    });
  }

  /**
   * POST /api/quotes/:id/accept-and-convert
   * Admin manual approval and immediate transactional conversion to Project + 2 Invoices
   */
  async acceptAndConvert(quoteId: string, note?: string | null, adminUserId?: string): Promise<{ quote: QuoteDto; project: any; upfrontInvoice: any; finalInvoice: any }> {
    const fullQuote = await this.getById(quoteId, { sub: adminUserId || '', role: 'admin', email: '', fullName: '' });
    const realQuoteId = fullQuote.id;

    if (fullQuote.status === 'approved') {
      const [existingProject] = await db.select().from(projects).where(eq(projects.quoteId, realQuoteId)).limit(1);
      if (existingProject) {
        return {
          quote: fullQuote,
          project: existingProject,
          upfrontInvoice: null,
          finalInvoice: null,
        };
      }
      throw new QuoteError('This quote has already been approved and converted', 409, 'ALREADY_APPROVED');
    }

    const currentV = fullQuote.activeVersion;
    if (!currentV) {
      throw new QuoteError('Active quote version not found', 400, 'NO_ACTIVE_VERSION');
    }

    return await db.transaction(async (tx) => {
      // 1. Mark quote as approved
      const [approvedQuote] = await tx
        .update(quotes)
        .set({
          status: 'approved',
          updatedAt: new Date(),
        })
        .where(eq(quotes.id, realQuoteId))
        .returning();

      // 2. Lock approved version
      await tx
        .update(quoteVersions)
        .set({
          status: 'approved',
          approvedAt: new Date(),
        })
        .where(eq(quoteVersions.id, currentV.id));

      // 3. Ensure Customer Record exists (if quote only had leadId)
      let customerId = approvedQuote.customerId;
      if (!customerId && approvedQuote.leadId) {
        const [lead] = await tx.select().from(leads).where(eq(leads.id, approvedQuote.leadId)).limit(1);
        if (lead) {
          const year = new Date().getFullYear();
          const [maxCust] = await tx
            .select({ customerNumber: customers.customerNumber })
            .from(customers)
            .where(sql`${customers.customerNumber} LIKE ${`CUST-${year}-%`}`)
            .orderBy(desc(customers.customerNumber))
            .limit(1);

          let nextSeq = 1;
          if (maxCust?.customerNumber) {
            const parts = maxCust.customerNumber.split('-');
            const lastNum = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(lastNum)) nextSeq = lastNum + 1;
          }
          let custNumber = `CUST-${year}-${String(nextSeq).padStart(3, '0')}`;
          const [existingNum] = await tx
            .select({ id: customers.id })
            .from(customers)
            .where(eq(customers.customerNumber, custNumber))
            .limit(1);
          if (existingNum) {
            custNumber = `CUST-${year}-${Date.now().toString().slice(-4)}`;
          }
          const [newCust] = await tx
            .insert(customers)
            .values({
              customerNumber: custNumber,
              firstName: lead.name.split(' ')[0] || lead.name,
              lastName: lead.name.split(' ').slice(1).join(' ') || '',
              email: lead.email || `klant-${Date.now()}@vanuitambacht.nl`,
              phone: lead.phone || '+31 6 00000000',
              streetAddress: lead.address || 'Op locatie',
              city: lead.city || 'Nederland',
            })
            .returning();

          customerId = newCust.id;
          await tx.update(quotes).set({ customerId }).where(eq(quotes.id, realQuoteId));
          await tx.update(leads).set({ customerId }).where(eq(leads.id, approvedQuote.leadId));
        }
      }

      if (!customerId) {
        const customerNumber = `K-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
        const [fallbackCust] = await tx
          .insert(customers)
          .values({
            customerNumber,
            firstName: 'Klant',
            lastName: approvedQuote.quoteNumber,
            email: `klant_${Date.now()}@vanuitambacht.nl`,
            phone: '+31 6 00000000',
            city: 'Nederland',
          })
          .returning();
        customerId = fallbackCust.id;
        await tx.update(quotes).set({ customerId }).where(eq(quotes.id, realQuoteId));
      }

      // 4. Create Project with status = 'in_progress' and orderStatus = 'in_voorbereiding'
      const projectNumber = await this.generateProjectNumber(0, tx);
      const productCategory = approvedQuote.productType.includes('garden') ? 'garden_room' : 'outdoor_kitchen';

      const [newProject] = await tx
        .insert(projects)
        .values({
          projectNumber,
          quoteId: approvedQuote.id,
          quoteVersionId: currentV.id,
          customerId: customerId!,
          projectType: productCategory,
          name: `${approvedQuote.productType} — ${fullQuote.customerName || 'Maatwerk'}`,
          status: 'in_progress',
          orderStatus: 'in_voorbereiding',
          contractValue: sql`${currentV.totalInclVat}::numeric`,
          agreedBuildPrice: currentV.costPrice != null ? sql`${currentV.costPrice}::numeric` : null,
          deliveryAddress: fullQuote.customerAddress || 'Op locatie',
          city: fullQuote.customerCity || 'Nederland',
        })
        .returning();

      // 5. Create Invoices: 40/40/20 for Garden Rooms, 50/50 for Outdoor Kitchens
      const today = new Date().toISOString().split('T')[0];
      const due14 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      let invNum1 = '';
      let invNum2 = '';
      let upfrontInv: any = null;
      let finalInv: any = null;

      if (approvedQuote.productType === 'garden_room') {
        // Garden Room: 3 instalments (40% upfront, 40% build start, 20% completion)
        const totIncl = currentV.totalInclVat;
        const totExcl = currentV.subtotalExclVat;

        const part1Incl = Math.round(totIncl * 0.40 * 100) / 100;
        const part1Excl = Math.round(totExcl * 0.40 * 100) / 100;
        const part1Vat = Math.round((part1Incl - part1Excl) * 100) / 100;

        const part2Incl = Math.round(totIncl * 0.40 * 100) / 100;
        const part2Excl = Math.round(totExcl * 0.40 * 100) / 100;
        const part2Vat = Math.round((part2Incl - part2Excl) * 100) / 100;

        const part3Incl = Math.round((totIncl - part1Incl - part2Incl) * 100) / 100;
        const part3Excl = Math.round((totExcl - part1Excl - part2Excl) * 100) / 100;
        const part3Vat = Math.round((part3Incl - part3Excl) * 100) / 100;

        const due45 = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const due60 = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        invNum1 = await this.generateInvoiceNumber(0, tx);
        const [inv1] = await tx
          .insert(invoices)
          .values({
            invoiceNumber: invNum1,
            projectId: newProject.id,
            customerId: customerId!,
            quoteId: approvedQuote.id,
            invoiceType: 'down_payment_upfront',
            status: 'draft',
            subtotalExclVat: sql`${part1Excl}::numeric`,
            totalVatAmount: sql`${part1Vat}::numeric`,
            totalInclVat: sql`${part1Incl}::numeric`,
            issueDate: today,
            dueDate: due14,
            paymentTermsDays: 14,
            notes: '40% Aanbetaling bij opdrachtbevestiging',
          })
          .returning();
        upfrontInv = inv1;

        await tx.insert(invoiceItems).values({
          invoiceId: inv1.id,
          position: 1,
          description: `1e termijn: 40% Aanbetaling voor ${approvedQuote.productType} (${approvedQuote.quoteNumber})`,
          quantity: sql`1::numeric`,
          unitPriceExclVat: sql`${part1Excl}::numeric`,
          vatRate: sql`21.00::numeric`,
          lineTotalExclVat: sql`${part1Excl}::numeric`,
          lineTotalInclVat: sql`${part1Incl}::numeric`,
        });

        invNum2 = await this.generateInvoiceNumber(1, tx);
        const [inv2] = await tx
          .insert(invoices)
          .values({
            invoiceNumber: invNum2,
            projectId: newProject.id,
            customerId: customerId!,
            quoteId: approvedQuote.id,
            invoiceType: 'interim_progress',
            status: 'draft',
            subtotalExclVat: sql`${part2Excl}::numeric`,
            totalVatAmount: sql`${part2Vat}::numeric`,
            totalInclVat: sql`${part2Incl}::numeric`,
            issueDate: today,
            dueDate: due45,
            paymentTermsDays: 14,
            notes: '40% Tussentijdse factuur bij start bouw',
          })
          .returning();

        await tx.insert(invoiceItems).values({
          invoiceId: inv2.id,
          position: 1,
          description: `2e termijn: 40% Tussentijdse factuur bij start bouw voor ${approvedQuote.productType} (${approvedQuote.quoteNumber})`,
          quantity: sql`1::numeric`,
          unitPriceExclVat: sql`${part2Excl}::numeric`,
          vatRate: sql`21.00::numeric`,
          lineTotalExclVat: sql`${part2Excl}::numeric`,
          lineTotalInclVat: sql`${part2Incl}::numeric`,
        });

        const invNum3 = await this.generateInvoiceNumber(2, tx);
        const [inv3] = await tx
          .insert(invoices)
          .values({
            invoiceNumber: invNum3,
            projectId: newProject.id,
            customerId: customerId!,
            quoteId: approvedQuote.id,
            invoiceType: 'final_completion',
            status: 'draft',
            subtotalExclVat: sql`${part3Excl}::numeric`,
            totalVatAmount: sql`${part3Vat}::numeric`,
            totalInclVat: sql`${part3Incl}::numeric`,
            issueDate: today,
            dueDate: due60,
            paymentTermsDays: 14,
            notes: '20% Eindfactuur bij oplevering',
          })
          .returning();
        finalInv = inv3;

        await tx.insert(invoiceItems).values({
          invoiceId: inv3.id,
          position: 1,
          description: `3e termijn: 20% Eindfactuur bij oplevering voor ${approvedQuote.productType} (${approvedQuote.quoteNumber})`,
          quantity: sql`1::numeric`,
          unitPriceExclVat: sql`${part3Excl}::numeric`,
          vatRate: sql`21.00::numeric`,
          lineTotalExclVat: sql`${part3Excl}::numeric`,
          lineTotalInclVat: sql`${part3Incl}::numeric`,
        });
      } else {
        // Outdoor Kitchen / Other: 2 Invoices (50% upfront due in 14 days, 50% completion due in 30 days)
        const halfTotalIncl = Math.round((currentV.totalInclVat / 2) * 100) / 100;
        const halfTotalExcl = Math.round((currentV.subtotalExclVat / 2) * 100) / 100;
        const halfVat = Math.round((halfTotalIncl - halfTotalExcl) * 100) / 100;

        const due30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        // Invoice 1: 50% Upfront
        invNum1 = await this.generateInvoiceNumber(0, tx);
        const [inv1] = await tx
          .insert(invoices)
          .values({
            invoiceNumber: invNum1,
            projectId: newProject.id,
            customerId: customerId!,
            quoteId: approvedQuote.id,
            invoiceType: 'down_payment_upfront',
            status: 'draft',
            subtotalExclVat: sql`${halfTotalExcl}::numeric`,
            totalVatAmount: sql`${halfVat}::numeric`,
            totalInclVat: sql`${halfTotalIncl}::numeric`,
            issueDate: today,
            dueDate: due14,
            paymentTermsDays: 14,
            notes: '50% Aanbetaling bij opdrachtbevestiging',
          })
          .returning();
        upfrontInv = inv1;

        await tx.insert(invoiceItems).values({
          invoiceId: upfrontInv.id,
          position: 1,
          description: `50% Aanbetaling voor ${approvedQuote.productType} (${approvedQuote.quoteNumber})`,
          quantity: sql`1::numeric`,
          unitPriceExclVat: sql`${halfTotalExcl}::numeric`,
          vatRate: sql`21.00::numeric`,
          lineTotalExclVat: sql`${halfTotalExcl}::numeric`,
          lineTotalInclVat: sql`${halfTotalIncl}::numeric`,
        });

        // Invoice 2: 50% Final Completion
        invNum2 = await this.generateInvoiceNumber(1, tx);
        const [inv2] = await tx
          .insert(invoices)
          .values({
            invoiceNumber: invNum2,
            projectId: newProject.id,
            customerId: customerId!,
            quoteId: approvedQuote.id,
            invoiceType: 'final_completion',
            status: 'draft',
            subtotalExclVat: sql`${halfTotalExcl}::numeric`,
            totalVatAmount: sql`${halfVat}::numeric`,
            totalInclVat: sql`${halfTotalIncl}::numeric`,
            issueDate: today,
            dueDate: due30,
            paymentTermsDays: 30,
            notes: '50% Eindfactuur bij oplevering',
          })
          .returning();
        finalInv = inv2;

        await tx.insert(invoiceItems).values({
          invoiceId: finalInv.id,
          position: 1,
          description: `50% Eindfactuur bij oplevering voor ${approvedQuote.productType} (${approvedQuote.quoteNumber})`,
          quantity: sql`1::numeric`,
          unitPriceExclVat: sql`${halfTotalExcl}::numeric`,
          vatRate: sql`21.00::numeric`,
          lineTotalExclVat: sql`${halfTotalExcl}::numeric`,
          lineTotalInclVat: sql`${halfTotalIncl}::numeric`,
        });
      }

      // 6. Update linked lead to workflowStep 7 and status 'won'
      if (approvedQuote.leadId) {
        await tx
          .update(leads)
          .set({
            workflowStep: 7,
            status: 'won',
            updatedAt: new Date(),
          })
          .where(eq(leads.id, approvedQuote.leadId));

        await tx.insert(commercialActions).values({
          leadId: approvedQuote.leadId,
          createdByUserId: adminUserId || (await tx.select({ id: users.id }).from(users).limit(1))[0].id,
          actionType: 'quote_accepted_project_created',
          note: `Quote ${approvedQuote.quoteNumber} approved & converted to Project ${newProject.projectNumber}. Invoices ${invNum1} & ${invNum2} issued. ${note || ''}`.trim(),
        });
      }

      return {
        quote: this.mapQuoteToDto(approvedQuote, { activeVersion: currentV }),
        project: newProject,
        upfrontInvoice: upfrontInv,
        finalInvoice: finalInv,
      };
    });
  }

  /**
   * GET /api/offerte/:token
   * Public customer-facing proposal endpoint (Strictly sanitized)
   */
  async getByPublicToken(token: string): Promise<PublicOfferteDto> {
    const [row] = await db
      .select({
        quote: quotes,
        customer: customers,
        lead: leads,
      })
      .from(quotes)
      .leftJoin(customers, eq(quotes.customerId, customers.id))
      .leftJoin(leads, eq(quotes.leadId, leads.id))
      .where(or(eq(quotes.publicToken, token), eq(quotes.quoteNumber, token)))
      .limit(1);

    if (!row) {
      throw new QuoteError('Quotation proposal not found or link has expired', 404, 'NOT_FOUND');
    }

    const { quote, customer: c, lead: l } = row;
    const today = new Date().toISOString().split('T')[0];
    const isExpired = quote.validUntil ? quote.validUntil < today : false;

    // Get current active version
    const [v] = await db
      .select()
      .from(quoteVersions)
      .where(and(eq(quoteVersions.quoteId, quote.id), eq(quoteVersions.isCurrent, true)))
      .limit(1);

    if (!v) {
      throw new QuoteError('Active proposal revision not found', 404, 'VERSION_NOT_FOUND');
    }

    // Get line items
    const rawItems = await db
      .select()
      .from(quoteItems)
      .where(eq(quoteItems.quoteVersionId, v.id))
      .orderBy(asc(quoteItems.position));

    const lineItems = rawItems.map((it) => ({
      title: it.title,
      description: it.description,
      quantity: Number(it.quantity),
      priceInclVat: Number(it.unitPriceInclVat),
      vatRate: Number(it.vatRate),
      lineTotalInclVat: Number(it.lineTotalInclVat),
      isIncluded: it.isIncluded,
      isStelpost: it.isStelpost,
    }));

    const customerName = c
      ? `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.companyName || 'Gewaardeerde Klant'
      : l
      ? l.name
      : 'Gewaardeerde Klant';

    const instConf = v.instalmentsConfig as InstalmentsConfig | null;
    const instalments = this.calculateInstalments(
      Number(v.totalInclVat),
      instConf?.count || 2,
      instConf?.percentages || [50, 50],
      instConf?.labels
    );

    const letterConfig = (v.letterConfig as LetterConfig) || {
      salutation: `Beste ${customerName.split(' ')[0]},`,
      letterParagraphs: [
        'Hartelijk dank voor je interesse in een exclusief maatwerk meubel van Vanuit Ambacht.',
        'In dit voorstel vind je de complete specificaties en investering.',
      ],
      signoffName: 'Tim & Bram',
      signoffRole: 'Oprichters Vanuit Ambacht',
    };

    return {
      quoteNumber: quote.quoteNumber,
      publicToken: quote.publicToken,
      customerName,
      customerCity: c?.city || l?.city || 'Nederland',
      customerAddress: c?.streetAddress || l?.address || undefined,
      productType: quote.productType,
      issueDate: String(quote.issueDate).split('T')[0],
      validUntil: String(quote.validUntil).split('T')[0],
      status: quote.status,
      isExpired,
      cover: {
        titleLine1: v.coverTitleLine1 || 'EEN BUITENKEUKEN OP MAAT',
        titleLine2: v.coverTitleLine2 || `VOOR DE FAMILIE ${customerName.toUpperCase()}`,
        customSubtitle: v.customSubtitle,
        photos: v.coverPhotos || ['/cover_img1.png', '/cover_img2.png', '/cover_img3.png'],
      },
      configuration: {
        dimensions: v.dimensionsText || '240 x 80 cm',
        woodType: v.woodType || 'Thermo Frake',
        woodLifespan: v.woodLifespan || '20 tot 25 jaar',
        optionsTitle: v.optionsTitle || 'Kamado / BBQ integratie',
        optionsSubtext: v.optionsSubtext || 'Rechts van het midden',
        deliveryTime: v.deliveryTimeText || '3 tot 5 weken',
        deliverySubtext: v.deliverySubtext || 'na technisch akkoord',
        specifications: (v.specificationsOverview as any) || [],
        diagram: v.diagramConfig as any,
      },
      investment: {
        lineItems,
        subtotalExclVat: Number(v.subtotalExclVat),
        vatAmount: Number(v.vatAmount),
        totalInclVat: Number(v.totalInclVat),
        finishTreatment: v.finishTreatment,
        stelpostDisclaimer: v.stelpostDisclaimer,
        vatDisclaimer: v.vatDisclaimer,
        validityNote: `Deze offerte is geldig tot en met ${String(quote.validUntil).split('T')[0]}`,
        instalments,
      },
      letterAndProcess: letterConfig,
      company: {
        name: 'Vanuit Ambacht',
        address: 'Industrieweg 14, Dongen',
        kvk: 'KVK 84729102',
        vat: 'BTW NL863492817B01',
        iban: 'NL91 ABNA 0412 8892 10',
        email: 'info@vanuitambacht.nl',
        phone: '+31 6 12345678',
      },
      digitalSignature: v.digitalSignature
        ? {
            signerName: (v.digitalSignature as any).signerName,
            approvedAt: (v.digitalSignature as any).approvedAt,
          }
        : null,
    };
  }

  /**
   * POST /api/offerte/:token/approve
   * Customer digital approval via public token (atomic transaction with replay & expiration guards)
   */
  async approveByPublicToken(
    token: string,
    input: ApproveOfferteInput,
    clientIp?: string,
    userAgent?: string
  ): Promise<{ success: boolean; quoteNumber: string; approvedAt: string; projectId: string }> {
    const [row] = await db
      .select({ quote: quotes })
      .from(quotes)
      .where(or(eq(quotes.publicToken, token), eq(quotes.quoteNumber, token)))
      .limit(1);

    if (!row) {
      throw new QuoteError('Quotation proposal not found', 404, 'NOT_FOUND');
    }

    const { quote } = row;
    const today = new Date().toISOString().split('T')[0];

    // Expiration Guard
    if (quote.validUntil && quote.validUntil < today) {
      throw new QuoteError(
        `This quote expired on ${quote.validUntil}. Please contact Vanuit Ambacht for a renewed proposal.`,
        400,
        'QUOTE_EXPIRED'
      );
    }

    // Replay Protection
    if (quote.status === 'approved') {
      throw new QuoteError(
        'This quote has already been approved and confirmed',
        409,
        'QUOTE_ALREADY_APPROVED'
      );
    }

    // Convert via atomic transaction
    const conversionResult = await this.acceptAndConvert(
      quote.id,
      `Digitally signed online by ${input.signerName} (IP: ${clientIp || 'Unknown'})`,
      undefined
    );

    // Save digital signature in active version
    const approvedAtIso = new Date().toISOString();
    await db
      .update(quoteVersions)
      .set({
        digitalSignature: {
          signerName: input.signerName,
          signerIp: clientIp || '127.0.0.1',
          userAgent: userAgent || 'Unknown',
          agreedTerms: true,
          signatureSvg: input.signatureSvg || null,
          approvedAt: approvedAtIso,
        },
      })
      .where(eq(quoteVersions.id, conversionResult.project.quoteVersionId));

    return {
      success: true,
      quoteNumber: quote.quoteNumber,
      approvedAt: approvedAtIso,
      projectId: conversionResult.project.id,
    };
  }

  /**
   * POST /api/offerte/:token/reject
   * Customer rejects or requests revision via public token
   */
  async rejectByPublicToken(token: string, input: RejectOfferteInput): Promise<{ success: boolean; message: string }> {
    const [quote] = await db
      .select()
      .from(quotes)
      .where(or(eq(quotes.publicToken, token), eq(quotes.quoteNumber, token)))
      .limit(1);

    if (!quote) {
      throw new QuoteError('Quotation proposal not found', 404, 'NOT_FOUND');
    }

    if (quote.status === 'approved') {
      throw new QuoteError('Cannot decline an already approved quote', 400, 'QUOTE_ALREADY_APPROVED');
    }

    await db.transaction(async (tx) => {
      await tx
        .update(quotes)
        .set({ status: 'declined', updatedAt: new Date() })
        .where(eq(quotes.id, quote.id));

      if (quote.leadId) {
        const [adminUser] = await tx.select({ id: users.id }).from(users).limit(1);
        await tx.insert(commercialActions).values({
          leadId: quote.leadId,
          createdByUserId: adminUser.id,
          actionType: 'quote_declined_by_customer',
          note: `Customer declined quote ${quote.quoteNumber}. Reason: ${input.reason}. Notes: ${input.requestedChanges || 'None'}`,
        });
      }
    });

    return { success: true, message: 'Proposal declined. Our team will review your feedback.' };
  }

  /**
   * GET PDF Buffer for quote
   */
  async generatePdf(quoteId: string, user: JwtTokenPayload): Promise<{ buffer: Buffer; fileName: string }> {
    const quoteDto = await this.getById(quoteId, user);
    const [compSettings] = await db.select().from(companySettings).limit(1);
    const buffer = quotePdfService.generatePdf(quoteDto, null, compSettings);
    const fileName = `Offerte_${quoteDto.quoteNumber}.pdf`;
    return { buffer, fileName };
  }

  /**
   * GET PDF Buffer for public offerte
   */
  async generatePublicPdf(token: string): Promise<{ buffer: Buffer; fileName: string }> {
    const [row] = await db
      .select({ id: quotes.id })
      .from(quotes)
      .where(or(eq(quotes.publicToken, token), eq(quotes.quoteNumber, token)))
      .limit(1);

    if (!row) {
      throw new QuoteError('Quotation proposal not found', 404, 'NOT_FOUND');
    }

    const [adminUser] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
    return await this.generatePdf(row.id, { sub: adminUser.id, role: 'admin', email: adminUser.email, fullName: adminUser.fullName });
  }
}

export const quoteService = new QuoteService();
