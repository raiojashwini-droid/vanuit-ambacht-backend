import { db } from '../../db/index.js';
import { documents, projects, customers, partners, projectMilestones, partnerPriceRequests, } from '../../db/schema.js';
import { eq, and, or, sql, desc, ilike, inArray } from 'drizzle-orm';
import { storageService } from '../../services/storage.service.js';
export class DocumentError extends Error {
    statusCode;
    code;
    constructor(message, statusCode = 400, code = 'DOCUMENT_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
    }
}
export class DocumentService {
    mapToDto(d) {
        return {
            id: d.id,
            documentNumber: d.documentNumber,
            documentType: d.documentType,
            category: d.category,
            description: d.description,
            fileName: d.fileName,
            fileUrl: d.fileUrl,
            fileSizeBytes: d.fileSizeBytes,
            mimeType: d.mimeType,
            projectId: d.projectId,
            quoteId: d.quoteId,
            partnerId: d.partnerId,
            leadId: d.leadId,
            invoiceId: d.invoiceId,
            isPublicForCustomer: d.isPublicForCustomer,
            isPublicForPartner: d.isPublicForPartner,
            uploadedByUserId: d.uploadedByUserId,
            createdAt: d.createdAt.toISOString(),
        };
    }
    /**
     * Auto-generate sequential document number: DOC-YYYY-XXXX
     */
    async generateDocumentNumber() {
        const year = new Date().getFullYear();
        const prefix = `DOC-${year}-`;
        const [latest] = await db
            .select({ documentNumber: documents.documentNumber })
            .from(documents)
            .where(sql `${documents.documentNumber} LIKE ${prefix + '%'}`)
            .orderBy(desc(documents.documentNumber))
            .limit(1);
        let nextSeq = 1;
        if (latest?.documentNumber) {
            const parts = latest.documentNumber.split('-');
            const lastSeq = parseInt(parts[2], 10);
            if (!isNaN(lastSeq))
                nextSeq = lastSeq + 1;
        }
        let docNum = `${prefix}${String(nextSeq).padStart(4, '0')}`;
        let exists = await db.select({ id: documents.id }).from(documents).where(eq(documents.documentNumber, docNum)).limit(1);
        while (exists.length > 0) {
            nextSeq++;
            docNum = `${prefix}${String(nextSeq).padStart(4, '0')}`;
            exists = await db.select({ id: documents.id }).from(documents).where(eq(documents.documentNumber, docNum)).limit(1);
        }
        return docNum;
    }
    /**
     * Helper: Resolve partner ID from user payload
     */
    async getPartnerIdForUser(userId) {
        const [p] = await db
            .select({ id: partners.id })
            .from(partners)
            .where(eq(partners.userId, userId))
            .limit(1);
        return p ? p.id : null;
    }
    /**
     * Helper: Resolve customer ID from user payload
     */
    async getCustomerIdForUser(userId) {
        const [c] = await db
            .select({ id: customers.id })
            .from(customers)
            .where(eq(customers.userId, userId))
            .limit(1);
        return c ? c.id : null;
    }
    /**
     * GET /api/documents
     * Supports filtering by category, search query, target entities, and RBAC scoping
     */
    async getDocuments(query, user) {
        const page = query.page || 1;
        const limit = query.limit || 50;
        const offset = (page - 1) * limit;
        const conditions = [];
        // Role-based scoping
        if (user.role === 'customer') {
            const customerId = await this.getCustomerIdForUser(user.sub);
            if (!customerId)
                return { data: [], total: 0, page, limit };
            // Customer can only see public documents linked to their projects/quotes/invoices
            // Find projects owned by this customer
            const custProjects = await db
                .select({ id: projects.id })
                .from(projects)
                .where(eq(projects.customerId, customerId));
            const projectIds = custProjects.map((p) => p.id);
            conditions.push(eq(documents.isPublicForCustomer, true));
            if (projectIds.length > 0) {
                conditions.push(or(sql `${documents.projectId} IN ${projectIds}`, 
                // Also allow general documents if made public for customer
                sql `num_nonnulls(${documents.projectId}, ${documents.quoteId}, ${documents.partnerId}, ${documents.leadId}, ${documents.invoiceId}) = 0`));
            }
            else {
                conditions.push(sql `num_nonnulls(${documents.projectId}, ${documents.quoteId}, ${documents.partnerId}, ${documents.leadId}, ${documents.invoiceId}) = 0`);
            }
        }
        else if (user.role === 'partner') {
            const partnerId = await this.getPartnerIdForUser(user.sub);
            conditions.push(eq(documents.isPublicForPartner, true));
            if (partnerId) {
                // Partner sees docs linked to their partnerId, assigned projects, assigned price request leads, or general company docs
                const partnerProjects = await db
                    .select({ id: projects.id })
                    .from(projects)
                    .where(eq(projects.partnerId, partnerId));
                const pIds = partnerProjects.map((p) => p.id);
                const partnerRequests = await db
                    .select({ leadId: partnerPriceRequests.leadId })
                    .from(partnerPriceRequests)
                    .where(eq(partnerPriceRequests.partnerId, partnerId));
                const reqLeadIds = partnerRequests.map((r) => r.leadId).filter(Boolean);
                const orConditions = [
                    eq(documents.partnerId, partnerId),
                    sql `num_nonnulls(${documents.projectId}, ${documents.quoteId}, ${documents.partnerId}, ${documents.leadId}, ${documents.invoiceId}) = 0`
                ];
                if (pIds.length > 0) {
                    orConditions.push(inArray(documents.projectId, pIds));
                }
                if (reqLeadIds.length > 0) {
                    orConditions.push(inArray(documents.leadId, reqLeadIds));
                }
                conditions.push(or(...orConditions));
            }
        }
        // Filter by category
        if (query.category && query.category !== 'All') {
            conditions.push(eq(documents.category, query.category));
        }
        // Filter by targets
        if (query.projectId)
            conditions.push(eq(documents.projectId, query.projectId));
        if (query.partnerId)
            conditions.push(eq(documents.partnerId, query.partnerId));
        if (query.leadId)
            conditions.push(eq(documents.leadId, query.leadId));
        if (query.quoteId)
            conditions.push(eq(documents.quoteId, query.quoteId));
        if (query.invoiceId)
            conditions.push(eq(documents.invoiceId, query.invoiceId));
        // Search query
        if (query.search && query.search.trim()) {
            const s = `%${query.search.trim()}%`;
            conditions.push(or(ilike(documents.fileName, s), ilike(documents.documentNumber, s), ilike(documents.description, s), ilike(documents.category, s)));
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        const [countResult] = await db
            .select({ count: sql `count(*)` })
            .from(documents)
            .where(whereClause);
        const rows = await db
            .select()
            .from(documents)
            .where(whereClause)
            .orderBy(desc(documents.createdAt))
            .limit(limit)
            .offset(offset);
        return {
            data: rows.map((r) => this.mapToDto(r)),
            total: Number(countResult?.count || 0),
            page,
            limit,
        };
    }
    /**
     * GET /api/documents/:id
     */
    async getDocumentById(id, user) {
        const [doc] = await db
            .select()
            .from(documents)
            .where(eq(documents.id, id))
            .limit(1);
        if (!doc) {
            throw new DocumentError('Document not found', 404, 'NOT_FOUND');
        }
        const { authorized } = await this.verifyDocumentAccess(doc, user);
        if (!authorized) {
            throw new DocumentError('You are not authorized to view this document', 403, 'FORBIDDEN');
        }
        return this.mapToDto(doc);
    }
    /**
     * POST /api/documents
     * Upload file to disk storage & record in database
     */
    async uploadDocument(data, user) {
        if (user.role === 'customer') {
            throw new DocumentError('Customers cannot upload to Document Vault', 403, 'FORBIDDEN');
        }
        // Verify XOR single-target constraint (at most one target FK)
        const targets = [data.projectId, data.quoteId, data.partnerId, data.leadId, data.invoiceId].filter(Boolean);
        if (targets.length > 1) {
            throw new DocumentError('Document cannot be linked to multiple targets simultaneously', 400, 'MULTIPLE_TARGETS');
        }
        // If user is partner, enforce that partner uploads link to their partner profile or assigned project
        if (user.role === 'partner') {
            const partnerId = await this.getPartnerIdForUser(user.sub);
            if (!partnerId) {
                throw new DocumentError('Partner profile not found', 403, 'FORBIDDEN');
            }
            if (data.projectId) {
                const [proj] = await db
                    .select({ id: projects.id, partnerId: projects.partnerId })
                    .from(projects)
                    .where(eq(projects.id, data.projectId))
                    .limit(1);
                if (!proj || proj.partnerId !== partnerId) {
                    throw new DocumentError('Partners can only upload documents to their assigned projects', 403, 'FORBIDDEN');
                }
            }
            else if (!data.partnerId || data.partnerId !== partnerId) {
                data.partnerId = partnerId;
            }
        }
        // Save physical file via StorageService
        const subfolder = data.projectId ? `projects/${data.projectId}/documents` : 'documents';
        const saved = await storageService.saveBase64(subfolder, data.fileName, data.fileData, data.mimeType || 'application/pdf', false);
        const docNumber = await this.generateDocumentNumber();
        const [created] = await db
            .insert(documents)
            .values({
            documentNumber: docNumber,
            documentType: data.documentType,
            category: data.category || 'General',
            description: data.description || null,
            fileName: data.fileName,
            fileUrl: saved.filePath,
            fileSizeBytes: saved.fileSizeBytes,
            mimeType: saved.mimeType,
            projectId: data.projectId || null,
            quoteId: data.quoteId || null,
            partnerId: data.partnerId || null,
            leadId: data.leadId || null,
            invoiceId: data.invoiceId || null,
            isPublicForCustomer: data.isPublicForCustomer ?? false,
            isPublicForPartner: data.isPublicForPartner ?? true,
            uploadedByUserId: user.sub,
        })
            .returning();
        return this.mapToDto(created);
    }
    /**
     * PATCH /api/documents/:id
     */
    async updateDocument(id, data, user) {
        if (user.role !== 'admin') {
            throw new DocumentError('Only admins can update document metadata', 403, 'FORBIDDEN');
        }
        const [doc] = await db
            .select()
            .from(documents)
            .where(eq(documents.id, id))
            .limit(1);
        if (!doc) {
            throw new DocumentError('Document not found', 404, 'NOT_FOUND');
        }
        const updateValues = {};
        if (data.category !== undefined)
            updateValues.category = data.category;
        if (data.description !== undefined)
            updateValues.description = data.description;
        if (data.isPublicForCustomer !== undefined)
            updateValues.isPublicForCustomer = data.isPublicForCustomer;
        if (data.isPublicForPartner !== undefined)
            updateValues.isPublicForPartner = data.isPublicForPartner;
        const [updated] = await db
            .update(documents)
            .set(updateValues)
            .where(eq(documents.id, id))
            .returning();
        return this.mapToDto(updated);
    }
    /**
     * DELETE /api/documents/:id
     * Removes DB record and purges physical file from storage
     */
    async deleteDocument(id, user) {
        if (user.role !== 'admin') {
            throw new DocumentError('Only admins can delete vault documents', 403, 'FORBIDDEN');
        }
        const [doc] = await db
            .select()
            .from(documents)
            .where(eq(documents.id, id))
            .limit(1);
        if (!doc) {
            throw new DocumentError('Document not found', 404, 'NOT_FOUND');
        }
        // Delete DB record
        await db.delete(documents).where(eq(documents.id, id));
        // Delete physical file
        if (doc.fileUrl && !doc.fileUrl.startsWith('http')) {
            await storageService.deleteFile(doc.fileUrl);
        }
        return { success: true, deletedId: id };
    }
    /**
     * Verify access for download / view
     */
    async verifyDocumentAccess(doc, user) {
        if (user.role === 'admin') {
            return { authorized: true, document: doc };
        }
        if (user.role === 'customer') {
            if (!doc.isPublicForCustomer) {
                return { authorized: false, document: doc };
            }
            // If document is linked to a project, check if customer owns that project
            if (doc.projectId) {
                const customerId = await this.getCustomerIdForUser(user.sub);
                if (!customerId)
                    return { authorized: false, document: doc };
                const [proj] = await db
                    .select({ customerId: projects.customerId })
                    .from(projects)
                    .where(eq(projects.id, doc.projectId))
                    .limit(1);
                if (!proj || proj.customerId !== customerId) {
                    return { authorized: false, document: doc };
                }
            }
            // If document is general, public for customer is allowed
            return { authorized: true, document: doc };
        }
        if (user.role === 'partner') {
            if (!doc.isPublicForPartner) {
                return { authorized: false, document: doc };
            }
            const partnerId = await this.getPartnerIdForUser(user.sub);
            if (!partnerId)
                return { authorized: false, document: doc };
            if (doc.partnerId && doc.partnerId === partnerId) {
                return { authorized: true, document: doc };
            }
            if (doc.projectId) {
                const [proj] = await db
                    .select({ partnerId: projects.partnerId })
                    .from(projects)
                    .where(eq(projects.id, doc.projectId))
                    .limit(1);
                if (proj && proj.partnerId === partnerId) {
                    return { authorized: true, document: doc };
                }
                return { authorized: false, document: doc };
            }
            if (doc.leadId) {
                const [assignedReq] = await db
                    .select({ id: partnerPriceRequests.id })
                    .from(partnerPriceRequests)
                    .where(and(eq(partnerPriceRequests.leadId, doc.leadId), eq(partnerPriceRequests.partnerId, partnerId)))
                    .limit(1);
                if (assignedReq) {
                    return { authorized: true, document: doc };
                }
                return { authorized: false, document: doc };
            }
            // General company documents (no target FKs) visible to partner if public
            if (!doc.projectId && !doc.leadId && !doc.partnerId && !doc.quoteId && !doc.invoiceId) {
                return { authorized: true, document: doc };
            }
            return { authorized: false, document: doc };
        }
        return { authorized: false, document: doc };
    }
    /**
     * GET /api/customer/projects/:id/documents
     * Scoped documents for customer portal view
     */
    async getCustomerDocumentsForProject(projectId, user) {
        const [project] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);
        if (!project) {
            throw new DocumentError('Project not found', 404, 'PROJECT_NOT_FOUND');
        }
        if (user.role === 'customer') {
            const customerId = await this.getCustomerIdForUser(user.sub);
            if (!customerId || project.customerId !== customerId) {
                throw new DocumentError('You are not authorized to view this project documents', 403, 'FORBIDDEN');
            }
        }
        // Fetch documents linked to project where isPublicForCustomer = true
        const docs = await db
            .select()
            .from(documents)
            .where(and(eq(documents.projectId, projectId), eq(documents.isPublicForCustomer, true)))
            .orderBy(desc(documents.createdAt));
        // Also get project milestones to determine availability of future docs
        const milestones = await db
            .select()
            .from(projectMilestones)
            .where(eq(projectMilestones.projectId, projectId));
        const isDelivered = milestones.some((m) => m.title.toLowerCase().includes('oplevering') && m.status === 'completed');
        const mappedDocs = docs.map((d) => ({
            id: d.id,
            documentNumber: d.documentNumber,
            title: d.fileName.replace(/\.[^/.]+$/, ''),
            fileName: d.fileName,
            category: d.category,
            description: d.description,
            status: 'available',
            fileSizeBytes: d.fileSizeBytes,
            mimeType: d.mimeType,
            createdAt: d.createdAt.toISOString(),
            downloadUrl: `/api/documents/${d.id}/download`,
        }));
        return {
            project: {
                id: project.id,
                projectNumber: project.projectNumber,
                title: project.name,
                name: project.name,
                status: project.status,
                isDelivered,
            },
            documents: mappedDocs,
        };
    }
}
export const documentService = new DocumentService();
