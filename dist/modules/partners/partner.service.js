import { eq, or, ilike, sql, desc, asc, and, arrayContains } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { partners, projects, partnerOffers, users } from '../../db/schema.js';
export class PartnerError extends Error {
    statusCode;
    code;
    constructor(message, statusCode = 400, code = 'PARTNER_ERROR') {
        super(message);
        this.name = 'PartnerError';
        this.statusCode = statusCode;
        this.code = code;
    }
}
export class PartnerService {
    /**
     * Generates a unique sequential partner code in format PRT-XXX
     */
    async generatePartnerCode(companyName) {
        const cleanName = companyName
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 4);
        const prefix = cleanName ? `PRT-${cleanName}-` : 'PRT-';
        const [latest] = await db
            .select({ partnerCode: partners.partnerCode })
            .from(partners)
            .where(ilike(partners.partnerCode, `${prefix}%`))
            .orderBy(desc(partners.partnerCode))
            .limit(1);
        if (!latest) {
            return `${prefix}01`;
        }
        const suffix = latest.partnerCode.replace(prefix, '');
        const currentNumber = parseInt(suffix, 10);
        const nextSeq = isNaN(currentNumber) ? 1 : currentNumber + 1;
        return `${prefix}${nextSeq.toString().padStart(2, '0')}`;
    }
    /**
     * List partners with search, workload filter, product types, sorting, and pagination
     */
    async list(params) {
        const page = params.page || 1;
        const limit = params.limit || 20;
        const offset = (page - 1) * limit;
        const conditions = [];
        if (params.search) {
            const term = `%${params.search.trim()}%`;
            conditions.push(or(ilike(partners.companyName, term), ilike(partners.contactPerson, term), ilike(partners.email, term), ilike(partners.phone, term), ilike(partners.partnerCode, term), ilike(partners.region, term)));
        }
        if (params.workloadStatus) {
            conditions.push(eq(partners.workloadStatus, params.workloadStatus));
        }
        if (params.region) {
            conditions.push(ilike(partners.region, `%${params.region.trim()}%`));
        }
        if (params.isActive !== undefined) {
            conditions.push(eq(partners.isActive, params.isActive));
        }
        if (params.productType) {
            conditions.push(arrayContains(partners.productTypes, [params.productType]));
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        // Count total matching
        const [countResult] = await db
            .select({ count: sql `count(*)::int` })
            .from(partners)
            .where(whereClause);
        const total = countResult?.count || 0;
        // Sort order
        let orderExpr = desc(partners.createdAt);
        if (params.sortBy === 'companyName') {
            orderExpr = params.sortOrder === 'asc' ? asc(partners.companyName) : desc(partners.companyName);
        }
        else if (params.sortBy === 'rating') {
            orderExpr = params.sortOrder === 'asc' ? asc(partners.rating) : desc(partners.rating);
        }
        else if (params.sortBy === 'workloadStatus') {
            orderExpr = params.sortOrder === 'asc' ? asc(partners.workloadStatus) : desc(partners.workloadStatus);
        }
        else {
            orderExpr = params.sortOrder === 'asc' ? asc(partners.createdAt) : desc(partners.createdAt);
        }
        const rows = await db
            .select()
            .from(partners)
            .where(whereClause)
            .orderBy(orderExpr)
            .limit(limit)
            .offset(offset);
        const items = rows.map((r) => ({
            id: r.id,
            partnerCode: r.partnerCode,
            companyName: r.companyName,
            contactPerson: r.contactPerson,
            email: r.email,
            phone: r.phone,
            kvkNumber: r.kvkNumber,
            btwNumber: r.btwNumber,
            region: r.region,
            workloadStatus: r.workloadStatus,
            availableWeeks: r.availableWeeks || [],
            rating: r.rating,
            specialties: r.specialties,
            productTypes: r.productTypes,
            isActive: r.isActive,
            userId: r.userId,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
        }));
        return {
            items,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 1,
        };
    }
    /**
     * Retrieves partner dossier including assigned projects, bids, and performance metrics
     */
    async getDossier(id) {
        const [partnerRecord] = await db
            .select()
            .from(partners)
            .where(eq(partners.id, id))
            .limit(1);
        if (!partnerRecord) {
            throw new PartnerError('Partner not found', 404, 'PARTNER_NOT_FOUND');
        }
        // 1. Assigned Projects
        const partnerProjects = await db
            .select({
            id: projects.id,
            projectNumber: projects.projectNumber,
            name: projects.name,
            projectType: projects.projectType,
            status: projects.status,
            progressPercentage: projects.progressPercentage,
            agreedBuildPrice: projects.agreedBuildPrice,
            createdAt: projects.createdAt,
        })
            .from(projects)
            .where(eq(projects.partnerId, id))
            .orderBy(desc(projects.createdAt));
        // 2. Submitted Offers
        const offers = await db
            .select({
            id: partnerOffers.id,
            requestId: partnerOffers.requestId,
            revisionNumber: partnerOffers.revisionNumber,
            costPrice: partnerOffers.costPrice,
            laborHours: partnerOffers.laborHours,
            status: partnerOffers.status,
            createdAt: partnerOffers.createdAt,
        })
            .from(partnerOffers)
            .where(eq(partnerOffers.partnerId, id))
            .orderBy(desc(partnerOffers.createdAt));
        const activeBuildsCount = partnerProjects.filter((p) => p.status === 'in_progress').length;
        const completedBuildsCount = partnerProjects.filter((p) => p.status === 'completed').length;
        const acceptedOffersCount = offers.filter((o) => o.status === 'accepted').length;
        return {
            id: partnerRecord.id,
            partnerCode: partnerRecord.partnerCode,
            companyName: partnerRecord.companyName,
            contactPerson: partnerRecord.contactPerson,
            email: partnerRecord.email,
            phone: partnerRecord.phone,
            kvkNumber: partnerRecord.kvkNumber,
            btwNumber: partnerRecord.btwNumber,
            region: partnerRecord.region,
            workloadStatus: partnerRecord.workloadStatus,
            availableWeeks: partnerRecord.availableWeeks || [],
            rating: partnerRecord.rating,
            specialties: partnerRecord.specialties,
            productTypes: partnerRecord.productTypes,
            isActive: partnerRecord.isActive,
            userId: partnerRecord.userId,
            createdAt: partnerRecord.createdAt.toISOString(),
            updatedAt: partnerRecord.updatedAt.toISOString(),
            projects: partnerProjects.map((p) => ({
                ...p,
                createdAt: p.createdAt.toISOString(),
            })),
            submittedOffers: offers.map((o) => ({
                ...o,
                createdAt: o.createdAt.toISOString(),
            })),
            metrics: {
                activeBuildsCount,
                completedBuildsCount,
                totalSubmittedOffersCount: offers.length,
                acceptedOffersCount,
                currentRating: partnerRecord.rating,
                workload: partnerRecord.workloadStatus,
            },
        };
    }
    /**
     * Create new craftsman partner
     */
    async create(data) {
        const partnerCode = data.partnerCode || (await this.generatePartnerCode(data.companyName));
        // Check code uniqueness
        const [existingCode] = await db
            .select({ id: partners.id })
            .from(partners)
            .where(eq(partners.partnerCode, partnerCode))
            .limit(1);
        if (existingCode) {
            throw new PartnerError(`Partner code '${partnerCode}' is already in use`, 409, 'DUPLICATE_CODE');
        }
        // Check userId if provided
        if (data.userId) {
            const [existingUser] = await db
                .select({ id: users.id })
                .from(users)
                .where(eq(users.id, data.userId))
                .limit(1);
            if (!existingUser) {
                throw new PartnerError('Linked user ID does not exist', 400, 'USER_NOT_FOUND');
            }
        }
        const [created] = await db
            .insert(partners)
            .values({
            partnerCode,
            companyName: data.companyName,
            contactPerson: data.contactPerson,
            email: data.email.toLowerCase(),
            phone: data.phone,
            kvkNumber: data.kvkNumber || null,
            btwNumber: data.btwNumber || null,
            region: data.region || null,
            workloadStatus: data.workloadStatus,
            availableWeeks: data.availableWeeks || null,
            rating: data.rating.toFixed(2),
            specialties: data.specialties || null,
            productTypes: data.productTypes || null,
            isActive: data.isActive ?? true,
            userId: data.userId || null,
        })
            .returning();
        return {
            id: created.id,
            partnerCode: created.partnerCode,
            companyName: created.companyName,
            contactPerson: created.contactPerson,
            email: created.email,
            phone: created.phone,
            kvkNumber: created.kvkNumber,
            btwNumber: created.btwNumber,
            region: created.region,
            workloadStatus: created.workloadStatus,
            availableWeeks: created.availableWeeks || [],
            rating: created.rating,
            specialties: created.specialties,
            productTypes: created.productTypes,
            isActive: created.isActive,
            userId: created.userId,
            createdAt: created.createdAt.toISOString(),
            updatedAt: created.updatedAt.toISOString(),
        };
    }
    /**
     * Update partner details
     */
    async update(id, data) {
        const [existing] = await db
            .select()
            .from(partners)
            .where(eq(partners.id, id))
            .limit(1);
        if (!existing) {
            throw new PartnerError('Partner not found', 404, 'PARTNER_NOT_FOUND');
        }
        if (data.partnerCode && data.partnerCode !== existing.partnerCode) {
            const [duplicate] = await db
                .select({ id: partners.id })
                .from(partners)
                .where(eq(partners.partnerCode, data.partnerCode))
                .limit(1);
            if (duplicate) {
                throw new PartnerError(`Partner code '${data.partnerCode}' is already in use`, 409, 'DUPLICATE_CODE');
            }
        }
        const [updated] = await db
            .update(partners)
            .set({
            ...data,
            rating: data.rating !== undefined ? data.rating.toFixed(2) : undefined,
            updatedAt: new Date(),
        })
            .where(eq(partners.id, id))
            .returning();
        return {
            id: updated.id,
            partnerCode: updated.partnerCode,
            companyName: updated.companyName,
            contactPerson: updated.contactPerson,
            email: updated.email,
            phone: updated.phone,
            kvkNumber: updated.kvkNumber,
            btwNumber: updated.btwNumber,
            region: updated.region,
            workloadStatus: updated.workloadStatus,
            availableWeeks: updated.availableWeeks || [],
            rating: updated.rating,
            specialties: updated.specialties,
            productTypes: updated.productTypes,
            isActive: updated.isActive,
            userId: updated.userId,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
        };
    }
    /**
     * Dedicated action: Update workload status and available weeks
     */
    async updateWorkload(id, workloadStatus, availableWeeks) {
        const updatePayload = {};
        if (workloadStatus !== undefined)
            updatePayload.workloadStatus = workloadStatus;
        if (availableWeeks !== undefined)
            updatePayload.availableWeeks = availableWeeks;
        return this.update(id, updatePayload);
    }
    /**
     * Dedicated action: Update partner rating (1.00 to 5.00)
     */
    async rate(id, rating) {
        if (rating < 1.0 || rating > 5.0) {
            throw new PartnerError('Rating must be between 1.00 and 5.00', 400, 'INVALID_RATING');
        }
        return this.update(id, { rating });
    }
    /**
     * Delete partner with dependency checks
     */
    async delete(id) {
        const [existing] = await db
            .select()
            .from(partners)
            .where(eq(partners.id, id))
            .limit(1);
        if (!existing) {
            throw new PartnerError('Partner not found', 404, 'PARTNER_NOT_FOUND');
        }
        // Check for active assigned projects
        const [hasProjects] = await db
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.partnerId, id))
            .limit(1);
        if (hasProjects) {
            throw new PartnerError('Cannot delete partner: Active projects are assigned to this craftsman. Reassign projects before deleting.', 409, 'PARTNER_HAS_PROJECTS');
        }
        // Check for offers
        const [hasOffers] = await db
            .select({ id: partnerOffers.id })
            .from(partnerOffers)
            .where(eq(partnerOffers.partnerId, id))
            .limit(1);
        if (hasOffers) {
            throw new PartnerError('Cannot delete partner: Commercial price bids exist from this craftsman. Archive craftsman instead.', 409, 'PARTNER_HAS_OFFERS');
        }
        await db.delete(partners).where(eq(partners.id, id));
        return {
            deleted: true,
            partnerCode: existing.partnerCode,
        };
    }
}
export const partnerService = new PartnerService();
