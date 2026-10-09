import { eq, and, or, ilike, sql, desc, asc, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  partnerPriceRequests,
  partnerOffers,
  leads,
  partners,
  users,
  customers,
  commercialActions,
  documents,
  projects,
} from '../../db/schema.js';
import type {
  CreatePartnerRequestInput,
  UpdatePartnerRequestInput,
  SubmitOfferInput,
  SelectOfferInput,
  DeclineRequestInput,
  PartnerRequestQueryInput,
} from './partner-request.schema.js';
import type {
  PartnerPriceRequestDto,
  PartnerOfferDto,
  PartnerRequestAttachmentDto,
  PartnerRequestListResponse,
  OfferBreakdown,
  RequestDimensions,
  RequestMaterials,
  RequestLocationAccess,
} from './partner-request.types.js';
import type { JwtTokenPayload } from '../../types/auth.types.js';

export class PartnerRequestError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 400, code = 'PARTNER_REQUEST_ERROR') {
    super(message);
    this.name = 'PartnerRequestError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class PartnerRequestService {
  /**
   * Resolve partner profile id for a given authenticated user
   */
  async getPartnerIdForUser(user: JwtTokenPayload): Promise<string | null> {
    if (user.role !== 'partner') {
      return null;
    }

    if (user.profileId) {
      return user.profileId;
    }

    const [partner] = await db
      .select({ id: partners.id })
      .from(partners)
      .where(eq(partners.userId, user.sub))
      .limit(1);

    return partner?.id || null;
  }

  /**
   * Generates a sequential request number: PR-YYYY-XXX
   */
  async generateRequestNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `PR-${year}-`;

    const [latest] = await db
      .select({ requestNumber: partnerPriceRequests.requestNumber })
      .from(partnerPriceRequests)
      .where(ilike(partnerPriceRequests.requestNumber, `${prefix}%`))
      .orderBy(desc(partnerPriceRequests.requestNumber))
      .limit(1);

    if (!latest) {
      return `${prefix}001`;
    }

    const currentNumber = parseInt(latest.requestNumber.replace(prefix, ''), 10);
    const nextSeq = isNaN(currentNumber) ? 1 : currentNumber + 1;
    return `${prefix}${nextSeq.toString().padStart(3, '0')}`;
  }

  /**
   * Generates a sequential offer number: OFF-YYYY-XXX
   */
  async generateOfferNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `OFF-${year}-`;

    const [latest] = await db
      .select({ offerNumber: partnerOffers.offerNumber })
      .from(partnerOffers)
      .where(ilike(partnerOffers.offerNumber, `${prefix}%`))
      .orderBy(desc(partnerOffers.offerNumber))
      .limit(1);

    if (!latest) {
      return `${prefix}001`;
    }

    const currentNumber = parseInt(latest.offerNumber.replace(prefix, ''), 10);
    const nextSeq = isNaN(currentNumber) ? 1 : currentNumber + 1;
    return `${prefix}${nextSeq.toString().padStart(3, '0')}`;
  }

  /**
   * Map database partner offer record to PartnerOfferDto
   */
  private mapOfferToDto(offer: any, partnerCompanyName?: string): PartnerOfferDto {
    return {
      id: offer.id,
      offerNumber: offer.offerNumber,
      requestId: offer.requestId,
      partnerId: offer.partnerId,
      partnerName: partnerCompanyName || offer.partnerName,
      revisionNumber: offer.revisionNumber,
      costPrice: Number(offer.costPrice),
      laborHours: offer.laborHours != null ? Number(offer.laborHours) : null,
      materialsCost: offer.materialsCost != null ? Number(offer.materialsCost) : null,
      laborCost: offer.laborCost != null ? Number(offer.laborCost) : null,
      estimatedLeadTimeWeeks: offer.estimatedLeadTimeWeeks,
      partnerNotes: offer.partnerNotes,
      breakdown: (offer.breakdown as OfferBreakdown) || null,
      status: offer.status,
      submittedAt: offer.submittedAt ? new Date(offer.submittedAt).toISOString() : new Date().toISOString(),
      createdAt: offer.createdAt ? new Date(offer.createdAt).toISOString() : new Date().toISOString(),
    };
  }

  /**
   * Map database partner price request record to PartnerPriceRequestDto with privacy sanitization
   */
  private mapRequestToDto(
    req: any,
    userRole: string,
    extra?: {
      partnerName?: string;
      customer?: any;
      attachments?: PartnerRequestAttachmentDto[];
      offers?: PartnerOfferDto[];
      activeOffer?: PartnerOfferDto | null;
    }
  ): PartnerPriceRequestDto {
    const dto: PartnerPriceRequestDto = {
      id: req.id,
      requestNumber: req.requestNumber,
      leadId: req.leadId,
      partnerId: req.partnerId,
      partnerName: extra?.partnerName || req.partnerCompanyName,
      category: req.category,
      productInfo: req.productInfo,
      dimensions: (req.dimensions as RequestDimensions) || null,
      materials: (req.materials as RequestMaterials) || null,
      locationAccess: (req.locationAccess as RequestLocationAccess) || null,
      requestedAt: req.requestedAt ? new Date(req.requestedAt).toISOString() : new Date().toISOString(),
      expectedResponseDate: req.expectedResponseDate ? String(req.expectedResponseDate).split('T')[0] : '',
      status: req.status,
      createdAt: req.createdAt ? new Date(req.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: req.updatedAt ? new Date(req.updatedAt).toISOString() : new Date().toISOString(),
      attachments: extra?.attachments || [],
      offers: extra?.offers || [],
      activeOffer: extra?.activeOffer || null,
    };

    // Confidential fields — ONLY visible to Admin
    if (userRole === 'admin' && extra?.customer) {
      const c = extra.customer;
      dto.customerName = `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.companyName || undefined;
      dto.customerEmail = c.email;
      dto.customerPhone = c.phone;
      dto.customerAddress = c.streetAddress ? `${c.streetAddress}, ${c.postalCode || ''} ${c.city || ''}`.trim() : c.city;
      dto.customerBudget = c.estimatedBudget != null ? Number(c.estimatedBudget) : null;
      dto.internalLockedCost = extra?.activeOffer?.costPrice || null;
      dto.targetMarginPercent = 35.0; // Default company margin
      if (dto.internalLockedCost) {
        dto.calculatedSellPrice = Number((dto.internalLockedCost / (1 - 0.35)).toFixed(2));
      }
    }

    return dto;
  }

  /**
   * GET /api/partner-requests
   * List partner inquiries with role-based scoping, search, filters & pagination
   */
  async list(query: PartnerRequestQueryInput, user: JwtTokenPayload): Promise<PartnerRequestListResponse> {
    const { page, limit, status, search, leadId, partnerId } = query;
    const offset = (page - 1) * limit;

    const conditions = [];

    // Partner isolation: partner can only see inquiries assigned to them
    if (user.role === 'partner') {
      const userPartnerId = await this.getPartnerIdForUser(user);
      if (!userPartnerId) {
        return { items: [], total: 0, page, limit, totalPages: 0 };
      }
      conditions.push(eq(partnerPriceRequests.partnerId, userPartnerId));
    } else if (partnerId) {
      conditions.push(eq(partnerPriceRequests.partnerId, partnerId));
    }

    if (leadId) {
      conditions.push(eq(partnerPriceRequests.leadId, leadId));
    }

    if (status) {
      conditions.push(eq(partnerPriceRequests.status, status));
    }

    if (search) {
      const searchPattern = `%${search}%`;
      conditions.push(
        or(
          ilike(partnerPriceRequests.requestNumber, searchPattern),
          ilike(partnerPriceRequests.category, searchPattern),
          ilike(partnerPriceRequests.productInfo, searchPattern),
          ilike(partners.companyName, searchPattern)
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(partnerPriceRequests)
      .leftJoin(partners, eq(partnerPriceRequests.partnerId, partners.id))
      .where(whereClause);

    const total = countResult?.count || 0;
    const totalPages = Math.ceil(total / limit);

    if (total === 0) {
      return { items: [], total: 0, page, limit, totalPages: 0 };
    }

    // Query records with partner info
    const rows = await db
      .select({
        request: partnerPriceRequests,
        partnerCompanyName: partners.companyName,
      })
      .from(partnerPriceRequests)
      .leftJoin(partners, eq(partnerPriceRequests.partnerId, partners.id))
      .where(whereClause)
      .orderBy(desc(partnerPriceRequests.createdAt))
      .limit(limit)
      .offset(offset);

    // Fetch active offers for these requests
    const requestIds = rows.map((r) => r.request.id);
    let activeOffersMap: Record<string, PartnerOfferDto> = {};

    if (requestIds.length > 0) {
      const offersList = await db
        .select()
        .from(partnerOffers)
        .where(
          and(
            inArray(partnerOffers.requestId, requestIds),
            or(eq(partnerOffers.status, 'accepted'), eq(partnerOffers.status, 'submitted'))
          )
        )
        .orderBy(desc(partnerOffers.revisionNumber));

      for (const off of offersList) {
        if (!activeOffersMap[off.requestId]) {
          activeOffersMap[off.requestId] = this.mapOfferToDto(off);
        }
      }
    }

    // Fetch tender attachments for these requests
    const leadIds = rows.map((r) => r.request.leadId).filter(Boolean);
    const partnerIds = rows.map((r) => r.request.partnerId).filter(Boolean);
    let attachmentsByLeadMap: Record<string, PartnerRequestAttachmentDto[]> = {};

    if (leadIds.length > 0 || partnerIds.length > 0) {
      const docConditions = [];
      const orParts = [];
      if (leadIds.length > 0) orParts.push(inArray(documents.leadId, leadIds));
      if (partnerIds.length > 0) orParts.push(inArray(documents.partnerId, partnerIds));
      if (orParts.length > 0) docConditions.push(or(...orParts));
      if (user.role === 'partner') docConditions.push(eq(documents.isPublicForPartner, true));

      const rawDocs = await db
        .select()
        .from(documents)
        .where(and(...docConditions))
        .orderBy(desc(documents.createdAt));

      for (const d of rawDocs) {
        const key = d.leadId || d.partnerId;
        if (key) {
          if (!attachmentsByLeadMap[key]) attachmentsByLeadMap[key] = [];
          attachmentsByLeadMap[key].push({
            id: d.id,
            fileName: d.fileName,
            fileUrl: d.fileUrl,
            mimeType: d.mimeType || 'application/octet-stream',
            fileSizeBytes: d.fileSizeBytes || 0,
            category: d.category || null,
            createdAt: d.createdAt.toISOString(),
          });
        }
      }
    }

    // Build DTOs
    const items: PartnerPriceRequestDto[] = rows.map(({ request: r, partnerCompanyName }) => {
      const attachments = attachmentsByLeadMap[r.leadId] || (r.partnerId ? attachmentsByLeadMap[r.partnerId] : []) || [];
      return this.mapRequestToDto(r, user.role, {
        partnerName: partnerCompanyName || undefined,
        activeOffer: activeOffersMap[r.id] || null,
        attachments,
      });
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * GET /api/partner-requests/:id
   * Complete Partner Price Request Dossier with specifications, attachments & offers
   */
  async getById(id: string, user: JwtTokenPayload): Promise<PartnerPriceRequestDto> {
    const [row] = await db
      .select({
        request: partnerPriceRequests,
        partnerCompanyName: partners.companyName,
        partnerContactPerson: partners.contactPerson,
        partnerEmail: partners.email,
        partnerPhone: partners.phone,
        leadName: leads.name,
        leadEmail: leads.email,
        leadPhone: leads.phone,
        leadAddress: leads.address,
        leadCity: leads.city,
        customerId: leads.customerId,
      })
      .from(partnerPriceRequests)
      .leftJoin(partners, eq(partnerPriceRequests.partnerId, partners.id))
      .leftJoin(leads, eq(partnerPriceRequests.leadId, leads.id))
      .where(eq(partnerPriceRequests.id, id))
      .limit(1);

    if (!row) {
      throw new PartnerRequestError('Partner price request not found', 404, 'NOT_FOUND');
    }

    const { request: req, partnerCompanyName } = row;

    // Authorization check for Partner role
    if (user.role === 'partner') {
      const userPartnerId = await this.getPartnerIdForUser(user);
      if (!userPartnerId || req.partnerId !== userPartnerId) {
        throw new PartnerRequestError('You are not authorized to view this partner price request', 403, 'FORBIDDEN');
      }
    }

    // Load customer data (Admin only)
    let customerData = null;
    if (user.role === 'admin' && row.customerId) {
      const [cust] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, row.customerId))
        .limit(1);
      if (cust) {
        customerData = {
          ...cust,
          estimatedBudget: null,
        };
      }
    } else if (user.role === 'admin') {
      customerData = {
        firstName: row.leadName || 'Lead Customer',
        lastName: '',
        companyName: null,
        email: row.leadEmail,
        phone: row.leadPhone,
        streetAddress: row.leadAddress,
        postalCode: undefined,
        city: row.leadCity,
        estimatedBudget: null,
      };
    }

    // Load offers for this request
    const offerConditions = [eq(partnerOffers.requestId, id)];
    if (user.role === 'partner') {
      const userPartnerId = await this.getPartnerIdForUser(user);
      offerConditions.push(eq(partnerOffers.partnerId, userPartnerId!));
    }

    const rawOffers = await db
      .select()
      .from(partnerOffers)
      .where(and(...offerConditions))
      .orderBy(desc(partnerOffers.revisionNumber));

    const offers = rawOffers.map((o) => this.mapOfferToDto(o, partnerCompanyName || undefined));
    const activeOffer = offers.find((o) => o.status === 'accepted') || offers.find((o) => o.status === 'submitted') || offers[0] || null;

    // Load tender attachments from documents table
    const docConditions = [
      or(
        eq(documents.leadId, req.leadId),
        eq(documents.partnerId, req.partnerId)
      )
    ];

    if (user.role === 'partner') {
      docConditions.push(eq(documents.isPublicForPartner, true));
    }

    const rawDocs = await db
      .select()
      .from(documents)
      .where(and(...docConditions))
      .orderBy(desc(documents.createdAt));

    const attachments: PartnerRequestAttachmentDto[] = rawDocs.map((d) => ({
      id: d.id,
      fileName: d.fileName,
      fileUrl: d.fileUrl,
      mimeType: d.mimeType || 'application/octet-stream',
      fileSizeBytes: d.fileSizeBytes || 0,
      createdAt: d.createdAt.toISOString(),
    }));

    return this.mapRequestToDto(req, user.role, {
      partnerName: partnerCompanyName || undefined,
      customer: customerData,
      attachments,
      offers,
      activeOffer,
    });
  }

  /**
   * POST /api/partner-requests
   * Admin creates a new partner price request inquiry (atomic transaction)
   */
  async create(input: CreatePartnerRequestInput, adminUserId: string): Promise<PartnerPriceRequestDto> {
    // 1. Verify lead exists
    const [lead] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, input.leadId))
      .limit(1);

    if (!lead) {
      throw new PartnerRequestError(`Lead not found with id: ${input.leadId}`, 404, 'LEAD_NOT_FOUND');
    }

    // 2. Verify partner exists
    const [partner] = await db
      .select()
      .from(partners)
      .where(eq(partners.id, input.partnerId))
      .limit(1);

    if (!partner) {
      throw new PartnerRequestError(`Partner not found with id: ${input.partnerId}`, 404, 'PARTNER_NOT_FOUND');
    }

    // 3. Execute atomic transaction
    const created = await db.transaction(async (tx) => {
      const requestNumber = await this.generateRequestNumber();

      const [newRequest] = await tx
        .insert(partnerPriceRequests)
        .values({
          requestNumber,
          leadId: input.leadId,
          partnerId: input.partnerId,
          createdByUserId: adminUserId,
          category: input.category || null,
          productInfo: input.productInfo || null,
          dimensions: input.dimensions || null,
          materials: input.materials || null,
          locationAccess: input.locationAccess || null,
          expectedResponseDate: input.expectedResponseDate,
          status: 'requested',
        })
        .returning();

      // Advance lead workflow to Step 2 (Partner price request) and status to in_conversation
      const nextStep = Math.max(lead.workflowStep, 2);
      await tx
        .update(leads)
        .set({
          workflowStep: nextStep,
          status: lead.status === 'new' ? 'in_conversation' : lead.status,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, input.leadId));

      // Log commercial action
      await tx.insert(commercialActions).values({
        leadId: input.leadId,
        createdByUserId: adminUserId,
        actionType: 'partner_request_created',
        note: `Partner price request ${requestNumber} sent to partner ${partner.companyName} (${partner.partnerCode})`,
      });

      return newRequest;
    });

    return this.mapRequestToDto(created, 'admin', {
      partnerName: partner.companyName,
    });
  }

  /**
   * PATCH /api/partner-requests/:id
   * Admin updates inquiry specifications before final offer selection
   */
  async update(id: string, input: UpdatePartnerRequestInput, adminUserId: string): Promise<PartnerPriceRequestDto> {
    const [existing] = await db
      .select()
      .from(partnerPriceRequests)
      .where(eq(partnerPriceRequests.id, id))
      .limit(1);

    if (!existing) {
      throw new PartnerRequestError('Partner price request not found', 404, 'NOT_FOUND');
    }

    if (existing.status === 'selected' || existing.status === 'cancelled') {
      throw new PartnerRequestError(
        `Cannot update request with status '${existing.status}'`,
        400,
        'INVALID_STATUS'
      );
    }

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (input.category !== undefined) updateData.category = input.category;
    if (input.productInfo !== undefined) updateData.productInfo = input.productInfo;
    if (input.dimensions !== undefined) updateData.dimensions = input.dimensions;
    if (input.materials !== undefined) updateData.materials = input.materials;
    if (input.locationAccess !== undefined) updateData.locationAccess = input.locationAccess;
    if (input.expectedResponseDate !== undefined) updateData.expectedResponseDate = input.expectedResponseDate;

    const [updated] = await db
      .update(partnerPriceRequests)
      .set(updateData)
      .where(eq(partnerPriceRequests.id, id))
      .returning();

    return this.mapRequestToDto(updated, 'admin');
  }

  /**
   * POST /api/partner-requests/:id/offers
   * Partner submits price bid with full structured cost breakdown (atomic transaction)
   */
  async submitOffer(requestId: string, input: SubmitOfferInput, user: JwtTokenPayload): Promise<PartnerOfferDto> {
    const [request] = await db
      .select({
        id: partnerPriceRequests.id,
        partnerId: partnerPriceRequests.partnerId,
        leadId: partnerPriceRequests.leadId,
        status: partnerPriceRequests.status,
      })
      .from(partnerPriceRequests)
      .where(eq(partnerPriceRequests.id, requestId))
      .limit(1);

    if (!request) {
      throw new PartnerRequestError('Partner price request not found', 404, 'NOT_FOUND');
    }

    if (request.status === 'cancelled' || request.status === 'declined') {
      throw new PartnerRequestError(`Cannot submit offer on request with status '${request.status}'`, 400, 'INVALID_STATUS');
    }

    // Role verification: If partner, must be assigned partner
    if (user.role === 'partner') {
      const userPartnerId = await this.getPartnerIdForUser(user);
      if (!userPartnerId || request.partnerId !== userPartnerId) {
        throw new PartnerRequestError('You are not authorized to submit an offer for this request', 403, 'FORBIDDEN');
      }
    }

    return await db.transaction(async (tx) => {
      // 1. Calculate revision number: max existing revision + 1
      const [maxRev] = await tx
        .select({ maxRevision: sql<number>`COALESCE(MAX(${partnerOffers.revisionNumber}), 0)::int` })
        .from(partnerOffers)
        .where(eq(partnerOffers.requestId, requestId));

      const nextRevision = (maxRev?.maxRevision || 0) + 1;

      // 2. Mark previous submitted/under_review offers as 'superseded'
      await tx
        .update(partnerOffers)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(partnerOffers.requestId, requestId),
            or(eq(partnerOffers.status, 'submitted'), eq(partnerOffers.status, 'under_review'))
          )
        );

      // 3. Generate sequential offer number
      const offerNumber = await this.generateOfferNumber();

      // 4. Insert new offer with structured breakdown JSONB
      const [newOffer] = await tx
        .insert(partnerOffers)
        .values({
          offerNumber,
          requestId,
          partnerId: request.partnerId,
          revisionNumber: nextRevision,
          costPrice: sql`${input.costPrice}::numeric`,
          laborHours: input.laborHours != null ? sql`${input.laborHours}::numeric` : null,
          materialsCost: input.materialsCost != null ? sql`${input.materialsCost}::numeric` : null,
          laborCost: input.laborCost != null ? sql`${input.laborCost}::numeric` : null,
          estimatedLeadTimeWeeks: input.estimatedLeadTimeWeeks || null,
          partnerNotes: input.partnerNotes || null,
          breakdown: input.breakdown || null,
          status: 'submitted',
        })
        .returning();

      // 5. Update partner price request status to 'offers_received'
      await tx
        .update(partnerPriceRequests)
        .set({
          status: 'offers_received',
          updatedAt: new Date(),
        })
        .where(eq(partnerPriceRequests.id, requestId));

      // 6. Update lead workflow to Step 3 (Partner price received)
      const [currentLead] = await tx
        .select({ workflowStep: leads.workflowStep })
        .from(leads)
        .where(eq(leads.id, request.leadId));

      if (currentLead && currentLead.workflowStep < 3) {
        await tx
          .update(leads)
          .set({
            workflowStep: 3,
            status: 'price_received',
            updatedAt: new Date(),
          })
          .where(eq(leads.id, request.leadId));
      }

      // 7. Log commercial action
      await tx.insert(commercialActions).values({
        leadId: request.leadId,
        createdByUserId: user.sub,
        actionType: 'partner_offer_submitted',
        note: `Partner submitted offer ${offerNumber} (Rev ${nextRevision}) — Total Cost: €${input.costPrice.toFixed(2)}`,
      });

      return this.mapOfferToDto(newOffer);
    });
  }

  /**
   * GET /api/partner-requests/:id/offers
   * List offer revision history for a price request
   */
  async getOffers(requestId: string, user: JwtTokenPayload): Promise<PartnerOfferDto[]> {
    const [request] = await db
      .select({ id: partnerPriceRequests.id, partnerId: partnerPriceRequests.partnerId })
      .from(partnerPriceRequests)
      .where(eq(partnerPriceRequests.id, requestId))
      .limit(1);

    if (!request) {
      throw new PartnerRequestError('Partner price request not found', 404, 'NOT_FOUND');
    }

    const conditions = [eq(partnerOffers.requestId, requestId)];

    if (user.role === 'partner') {
      const userPartnerId = await this.getPartnerIdForUser(user);
      if (!userPartnerId || request.partnerId !== userPartnerId) {
        throw new PartnerRequestError('You are not authorized to view offers for this request', 403, 'FORBIDDEN');
      }
      conditions.push(eq(partnerOffers.partnerId, userPartnerId));
    }

    const rows = await db
      .select({
        offer: partnerOffers,
        partnerCompanyName: partners.companyName,
      })
      .from(partnerOffers)
      .leftJoin(partners, eq(partnerOffers.partnerId, partners.id))
      .where(and(...conditions))
      .orderBy(desc(partnerOffers.revisionNumber));

    return rows.map((r) => this.mapOfferToDto(r.offer, r.partnerCompanyName || undefined));
  }

  /**
   * PATCH /api/partner-requests/:id/select-offer
   * Admin selects winning offer (atomic transaction)
   */
  async selectOffer(requestId: string, input: SelectOfferInput, adminUserId: string): Promise<{ request: PartnerPriceRequestDto; selectedOffer: PartnerOfferDto }> {
    const [request] = await db
      .select()
      .from(partnerPriceRequests)
      .where(eq(partnerPriceRequests.id, requestId))
      .limit(1);

    if (!request) {
      throw new PartnerRequestError('Partner price request not found', 404, 'NOT_FOUND');
    }

    const [offer] = await db
      .select()
      .from(partnerOffers)
      .where(and(eq(partnerOffers.id, input.offerId), eq(partnerOffers.requestId, requestId)))
      .limit(1);

    if (!offer) {
      throw new PartnerRequestError(`Offer ${input.offerId} does not belong to request ${requestId}`, 404, 'OFFER_NOT_FOUND');
    }

    if (offer.status !== 'submitted' && offer.status !== 'under_review') {
      throw new PartnerRequestError(`Cannot select offer with status '${offer.status}'`, 400, 'INVALID_OFFER_STATUS');
    }

    return await db.transaction(async (tx) => {
      // 1. Mark selected offer as 'accepted'
      const [acceptedOffer] = await tx
        .update(partnerOffers)
        .set({ status: 'accepted' })
        .where(eq(partnerOffers.id, input.offerId))
        .returning();

      // 2. Mark competing active offers as 'rejected'
      await tx
        .update(partnerOffers)
        .set({ status: 'rejected' })
        .where(
          and(
            eq(partnerOffers.requestId, requestId),
            sql`${partnerOffers.id} != ${input.offerId}`,
            or(eq(partnerOffers.status, 'submitted'), eq(partnerOffers.status, 'under_review'))
          )
        );

      // 3. Mark partner price request as 'selected'
      const [updatedRequest] = await tx
        .update(partnerPriceRequests)
        .set({
          status: 'selected',
          updatedAt: new Date(),
        })
        .where(eq(partnerPriceRequests.id, requestId))
        .returning();

      // 4. Advance lead workflow to Step 4 (Build the quote)
      const [lead] = await tx
        .select()
        .from(leads)
        .where(eq(leads.id, request.leadId));

      if (lead) {
        const nextStep = Math.max(lead.workflowStep, 4);
        await tx
          .update(leads)
          .set({
            workflowStep: nextStep,
            status: 'quote_sent',
            updatedAt: new Date(),
          })
          .where(eq(leads.id, request.leadId));
      }

      // 5. Log commercial action
      const costFormatted = Number(acceptedOffer.costPrice).toFixed(2);
      await tx.insert(commercialActions).values({
        leadId: request.leadId,
        createdByUserId: adminUserId,
        actionType: 'partner_offer_selected',
        note: `Offer ${acceptedOffer.offerNumber} selected by admin for €${costFormatted}. ${input.note || ''}`.trim(),
      });

      return {
        request: this.mapRequestToDto(updatedRequest, 'admin'),
        selectedOffer: this.mapOfferToDto(acceptedOffer),
      };
    });
  }

  /**
   * POST /api/partner-requests/:id/decline
   * Partner declines inquiry with reason (atomic transaction)
   */
  async decline(requestId: string, input: DeclineRequestInput, user: JwtTokenPayload): Promise<PartnerPriceRequestDto> {
    const [request] = await db
      .select()
      .from(partnerPriceRequests)
      .where(eq(partnerPriceRequests.id, requestId))
      .limit(1);

    if (!request) {
      throw new PartnerRequestError('Partner price request not found', 404, 'NOT_FOUND');
    }

    if (request.status === 'selected' || request.status === 'declined' || request.status === 'cancelled') {
      throw new PartnerRequestError(`Cannot decline request with status '${request.status}'`, 400, 'INVALID_STATUS');
    }

    if (user.role === 'partner') {
      const userPartnerId = await this.getPartnerIdForUser(user);
      if (!userPartnerId || request.partnerId !== userPartnerId) {
        throw new PartnerRequestError('You are not authorized to decline this request', 403, 'FORBIDDEN');
      }
    }

    return await db.transaction(async (tx) => {
      // 1. Update request status to 'declined'
      const [updatedRequest] = await tx
        .update(partnerPriceRequests)
        .set({
          status: 'declined',
          updatedAt: new Date(),
        })
        .where(eq(partnerPriceRequests.id, requestId))
        .returning();

      // 2. Log commercial action on lead
      await tx.insert(commercialActions).values({
        leadId: request.leadId,
        createdByUserId: user.sub,
        actionType: 'partner_request_declined',
        note: `Partner declined price request ${request.requestNumber}. Reason: ${input.reason}`,
      });

      return this.mapRequestToDto(updatedRequest, user.role);
    });
  }

  /**
   * Document authorization helper for GET /api/documents/:id/download
   */
  async verifyDocumentAccess(documentId: string, user: JwtTokenPayload): Promise<{ authorized: boolean; document?: any }> {
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);

    if (!doc) {
      return { authorized: false };
    }

    // Admin has universal access
    if (user.role === 'admin') {
      return { authorized: true, document: doc };
    }

    // Partner access checks
    if (user.role === 'partner') {
      const userPartnerId = await this.getPartnerIdForUser(user);
      if (!userPartnerId) {
        return { authorized: false, document: doc };
      }

      // Check if document belongs directly to partner
      if (doc.partnerId === userPartnerId) {
        return { authorized: true, document: doc };
      }

      // Check if document is linked to a project where partner is assigned
      if (doc.projectId && doc.isPublicForPartner) {
        const [assignedProject] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, doc.projectId),
              eq(projects.partnerId, userPartnerId)
            )
          )
          .limit(1);

        if (assignedProject) {
          return { authorized: true, document: doc };
        }
      }

      // Check if document is linked to a lead where partner has an assigned price request
      if (doc.leadId && doc.isPublicForPartner) {
        const [assignedReq] = await db
          .select({ id: partnerPriceRequests.id })
          .from(partnerPriceRequests)
          .where(
            and(
              eq(partnerPriceRequests.leadId, doc.leadId),
              eq(partnerPriceRequests.partnerId, userPartnerId)
            )
          )
          .limit(1);

        if (assignedReq) {
          return { authorized: true, document: doc };
        }
      }

      return { authorized: false, document: doc };
    }

    // Customer access checks
    if (user.role === 'customer') {
      const [cust] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.userId, user.sub))
        .limit(1);

      if (!cust) {
        return { authorized: false, document: doc };
      }

      if (doc.projectId && doc.isPublicForCustomer) {
        const [custProject] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, doc.projectId),
              eq(projects.customerId, cust.id)
            )
          )
          .limit(1);

        if (custProject) {
          return { authorized: true, document: doc };
        }
      }

      return { authorized: false, document: doc };
    }

    return { authorized: false, document: doc };
  }
}

export const partnerRequestService = new PartnerRequestService();
