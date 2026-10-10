import { eq, or, ilike, desc, and, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { partnerCandidates, partners, users } from '../../db/schema.js';
import { partnerService } from '../partners/partner.service.js';
import type {
  CreateCandidateInput,
  UpdateCandidateInput,
  CandidateQueryParams,
  ConvertCandidateInput,
} from './candidate.schema.js';
import type { CandidateDto, CandidateListResponse, CandidateStage } from './candidate.types.js';

export class CandidateError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 400, code = 'CANDIDATE_ERROR') {
    super(message);
    this.name = 'CandidateError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class CandidateService {
  /**
   * Generates a sequential candidate number in format CAND-YYYY-XXX
   */
  async generateCandidateNumber(dbClient: any = db): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `CAND-${year}-`;

    const [latest] = await dbClient
      .select({ candidateNumber: partnerCandidates.candidateNumber })
      .from(partnerCandidates)
      .where(ilike(partnerCandidates.candidateNumber, `${prefix}%`))
      .orderBy(desc(partnerCandidates.candidateNumber))
      .limit(1);

    if (!latest) {
      return `${prefix}001`;
    }

    const suffix = latest.candidateNumber.replace(prefix, '');
    const currentNumber = parseInt(suffix, 10);
    const nextSeq = isNaN(currentNumber) ? 1 : currentNumber + 1;
    return `${prefix}${nextSeq.toString().padStart(3, '0')}`;
  }

  /**
   * List prospective candidates with filtering, search, and Kanban stage counts
   */
  async list(params: CandidateQueryParams): Promise<CandidateListResponse> {
    const conditions = [];

    if (params.search) {
      const term = `%${params.search.trim()}%`;
      conditions.push(
        or(
          ilike(partnerCandidates.name, term),
          ilike(partnerCandidates.companyName, term),
          ilike(partnerCandidates.email, term),
          ilike(partnerCandidates.phone, term),
          ilike(partnerCandidates.candidateNumber, term),
          ilike(partnerCandidates.region, term)
        )
      );
    }

    if (params.stage) {
      conditions.push(eq(partnerCandidates.stage, params.stage));
    }

    if (params.region) {
      conditions.push(ilike(partnerCandidates.region, `%${params.region.trim()}%`));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select()
      .from(partnerCandidates)
      .where(whereClause)
      .orderBy(desc(partnerCandidates.createdAt));

    // Calculate stage counts for Kanban header badges across all records
    const allStageRows = await db
      .select({
        stage: partnerCandidates.stage,
        count: sql<number>`count(*)::int`,
      })
      .from(partnerCandidates)
      .groupBy(partnerCandidates.stage);

    const stageCounts: Record<CandidateStage, number> = {
      interested: 0,
      in_discussion: 0,
      trial_project: 0,
      active: 0,
      rejected: 0,
    };

    for (const r of allStageRows) {
      if (r.stage in stageCounts) {
        stageCounts[r.stage as CandidateStage] = r.count;
      }
    }

    const items: CandidateDto[] = rows.map((r) => ({
      id: r.id,
      candidateNumber: r.candidateNumber,
      name: r.name,
      companyName: r.companyName,
      email: r.email,
      phone: r.phone,
      region: r.region,
      stage: r.stage as CandidateStage,
      notes: r.notes,
      specialties: r.specialties,
      productTypes: r.productTypes,
      kvkNumber: r.kvkNumber,
      btwNumber: r.btwNumber,
      convertedPartnerId: r.convertedPartnerId,
      convertedAt: r.convertedAt ? r.convertedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));

    return {
      items,
      total: items.length,
      stageCounts,
    };
  }

  /**
   * Get single candidate by UUID
   */
  async getById(id: string): Promise<CandidateDto> {
    const [row] = await db
      .select()
      .from(partnerCandidates)
      .where(eq(partnerCandidates.id, id))
      .limit(1);

    if (!row) {
      throw new CandidateError('Candidate not found', 404, 'CANDIDATE_NOT_FOUND');
    }

    return {
      id: row.id,
      candidateNumber: row.candidateNumber,
      name: row.name,
      companyName: row.companyName,
      email: row.email,
      phone: row.phone,
      region: row.region,
      stage: row.stage as CandidateStage,
      notes: row.notes,
      specialties: row.specialties,
      productTypes: row.productTypes,
      kvkNumber: row.kvkNumber,
      btwNumber: row.btwNumber,
      convertedPartnerId: row.convertedPartnerId,
      convertedAt: row.convertedAt ? row.convertedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Create a new prospective candidate
   */
  async create(data: CreateCandidateInput): Promise<CandidateDto> {
    const normalizedEmail = data.email.toLowerCase().trim();

    // Check duplicate active candidate with same email
    const [existing] = await db
      .select({ id: partnerCandidates.id, stage: partnerCandidates.stage })
      .from(partnerCandidates)
      .where(eq(partnerCandidates.email, normalizedEmail))
      .limit(1);

    if (existing && existing.stage !== 'rejected') {
      throw new CandidateError(
        `A candidate with email "${normalizedEmail}" is already in the pipeline (Stage: ${existing.stage})`,
        409,
        'DUPLICATE_CANDIDATE'
      );
    }

    const candidateNumber = await this.generateCandidateNumber();

    const [created] = await db
      .insert(partnerCandidates)
      .values({
        candidateNumber,
        name: data.name.trim(),
        companyName: data.companyName?.trim() || data.name.trim(),
        email: normalizedEmail,
        phone: data.phone.trim(),
        region: data.region?.trim() || 'Nederland',
        stage: data.stage || 'interested',
        notes: data.notes?.trim() || null,
        specialties: data.specialties || null,
        productTypes: data.productTypes || null,
        kvkNumber: data.kvkNumber?.trim() || null,
        btwNumber: data.btwNumber?.trim() || null,
      })
      .returning();

    return {
      id: created.id,
      candidateNumber: created.candidateNumber,
      name: created.name,
      companyName: created.companyName,
      email: created.email,
      phone: created.phone,
      region: created.region,
      stage: created.stage as CandidateStage,
      notes: created.notes,
      specialties: created.specialties,
      productTypes: created.productTypes,
      kvkNumber: created.kvkNumber,
      btwNumber: created.btwNumber,
      convertedPartnerId: created.convertedPartnerId,
      convertedAt: created.convertedAt ? created.convertedAt.toISOString() : null,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  /**
   * Update candidate attributes
   */
  async update(id: string, data: UpdateCandidateInput): Promise<CandidateDto> {
    const existing = await this.getById(id);

    const updatePayload: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) updatePayload.name = data.name.trim();
    if (data.companyName !== undefined) updatePayload.companyName = data.companyName.trim();
    if (data.email !== undefined) updatePayload.email = data.email.toLowerCase().trim();
    if (data.phone !== undefined) updatePayload.phone = data.phone.trim();
    if (data.region !== undefined) updatePayload.region = data.region.trim();
    if (data.stage !== undefined) updatePayload.stage = data.stage;
    if (data.notes !== undefined) updatePayload.notes = data.notes.trim();
    if (data.specialties !== undefined) updatePayload.specialties = data.specialties;
    if (data.productTypes !== undefined) updatePayload.productTypes = data.productTypes;
    if (data.kvkNumber !== undefined) updatePayload.kvkNumber = data.kvkNumber?.trim() || null;
    if (data.btwNumber !== undefined) updatePayload.btwNumber = data.btwNumber?.trim() || null;

    const [updated] = await db
      .update(partnerCandidates)
      .set(updatePayload)
      .where(eq(partnerCandidates.id, id))
      .returning();

    return {
      id: updated.id,
      candidateNumber: updated.candidateNumber,
      name: updated.name,
      companyName: updated.companyName,
      email: updated.email,
      phone: updated.phone,
      region: updated.region,
      stage: updated.stage as CandidateStage,
      notes: updated.notes,
      specialties: updated.specialties,
      productTypes: updated.productTypes,
      kvkNumber: updated.kvkNumber,
      btwNumber: updated.btwNumber,
      convertedPartnerId: updated.convertedPartnerId,
      convertedAt: updated.convertedAt ? updated.convertedAt.toISOString() : null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Update candidate stage (Kanban card advance/move)
   */
  async updateStage(id: string, stage: CandidateStage, notes?: string): Promise<CandidateDto> {
    const existing = await this.getById(id);

    let updatedNotes = existing.notes;
    if (notes?.trim()) {
      updatedNotes = updatedNotes ? `${updatedNotes}\n[${stage.toUpperCase()}]: ${notes.trim()}` : notes.trim();
    }

    const [updated] = await db
      .update(partnerCandidates)
      .set({
        stage,
        notes: updatedNotes,
        updatedAt: new Date(),
      })
      .where(eq(partnerCandidates.id, id))
      .returning();

    return {
      id: updated.id,
      candidateNumber: updated.candidateNumber,
      name: updated.name,
      companyName: updated.companyName,
      email: updated.email,
      phone: updated.phone,
      region: updated.region,
      stage: updated.stage as CandidateStage,
      notes: updated.notes,
      specialties: updated.specialties,
      productTypes: updated.productTypes,
      kvkNumber: updated.kvkNumber,
      btwNumber: updated.btwNumber,
      convertedPartnerId: updated.convertedPartnerId,
      convertedAt: updated.convertedAt ? updated.convertedAt.toISOString() : null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Atomic Transactional Conversion:
   * Converts a candidate into an official partner with portal login credentials.
   * All mutations occur inside a single db.transaction to guarantee integrity.
   */
  async convert(id: string, data: ConvertCandidateInput): Promise<{ partner: any; candidate: CandidateDto }> {
    return await db.transaction(async (tx) => {
      // 1. Fetch candidate inside transaction
      const [candidate] = await tx
        .select()
        .from(partnerCandidates)
        .where(eq(partnerCandidates.id, id))
        .limit(1);

      if (!candidate) {
        throw new CandidateError('Candidate not found', 404, 'CANDIDATE_NOT_FOUND');
      }

      // 2. Prevent duplicate conversion
      if (candidate.convertedPartnerId) {
        throw new CandidateError(
          `Candidate ${candidate.candidateNumber} is already converted to partner ID ${candidate.convertedPartnerId}`,
          409,
          'ALREADY_CONVERTED'
        );
      }

      const normalizedEmail = candidate.email.toLowerCase().trim();

      // 3. Create the official partner and linked user account using partnerService.create
      const partnerPayload = {
        contactPerson: candidate.name,
        companyName: data.companyName?.trim() || candidate.companyName || candidate.name,
        email: normalizedEmail,
        phone: candidate.phone,
        password: data.password,
        region: candidate.region || 'Nederland',
        rating: 5.0,
        specialties: candidate.specialties || null,
        productTypes: data.productTypes || candidate.productTypes || null,
        kvkNumber: data.kvkNumber?.trim() || candidate.kvkNumber || null,
        btwNumber: data.btwNumber?.trim() || candidate.btwNumber || null,
        workloadStatus: data.workloadStatus || 'available',
        isActive: true,
      };

      const createdPartner = await partnerService.create(partnerPayload, tx);

      // 4. Update the candidate record with conversion audit trail
      const conversionTimestamp = new Date();
      const [updatedCandidate] = await tx
        .update(partnerCandidates)
        .set({
          stage: 'active',
          convertedPartnerId: createdPartner.id,
          convertedAt: conversionTimestamp,
          updatedAt: conversionTimestamp,
        })
        .where(eq(partnerCandidates.id, id))
        .returning();

      return {
        partner: createdPartner,
        candidate: {
          id: updatedCandidate.id,
          candidateNumber: updatedCandidate.candidateNumber,
          name: updatedCandidate.name,
          companyName: updatedCandidate.companyName,
          email: updatedCandidate.email,
          phone: updatedCandidate.phone,
          region: updatedCandidate.region,
          stage: updatedCandidate.stage as CandidateStage,
          notes: updatedCandidate.notes,
          specialties: updatedCandidate.specialties,
          productTypes: updatedCandidate.productTypes,
          kvkNumber: updatedCandidate.kvkNumber,
          btwNumber: updatedCandidate.btwNumber,
          convertedPartnerId: updatedCandidate.convertedPartnerId,
          convertedAt: updatedCandidate.convertedAt ? updatedCandidate.convertedAt.toISOString() : null,
          createdAt: updatedCandidate.createdAt.toISOString(),
          updatedAt: updatedCandidate.updatedAt.toISOString(),
        },
      };
    });
  }

  /**
   * Delete or archive a candidate
   */
  async delete(id: string): Promise<{ deleted: boolean; id: string }> {
    const candidate = await this.getById(id);

    // If candidate has already been converted to an active partner, retain history
    if (candidate.convertedPartnerId) {
      throw new CandidateError(
        'Cannot delete candidate: This craftsman has already been converted to an active partner. Manage the official partner dossier instead.',
        409,
        'CANDIDATE_ALREADY_CONVERTED'
      );
    }

    await db
      .delete(partnerCandidates)
      .where(eq(partnerCandidates.id, id));

    return {
      deleted: true,
      id,
    };
  }
}

export const candidateService = new CandidateService();
