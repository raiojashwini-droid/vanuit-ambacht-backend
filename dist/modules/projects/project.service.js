import { db } from '../../db/index.js';
import { projects, customers, partners, invoices, planningEvents, documents, projectMilestones, projectPhotos, } from '../../db/schema.js';
import { eq, and, or, sql, desc, asc, ilike } from 'drizzle-orm';
import { storageService } from '../../services/storage.service.js';
import { projectPdfService } from './project-pdf.service.js';
import { projectMilestoneService } from './project-milestone.service.js';
import { projectPhotoService } from './project-photo.service.js';
export class ProjectError extends Error {
    statusCode;
    code;
    constructor(message, statusCode = 400, code = 'PROJECT_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
    }
}
export class ProjectService {
    /**
     * Helper: Find partner ID for the current authenticated user
     */
    async getPartnerIdForUser(user) {
        const [row] = await db
            .select({ id: partners.id })
            .from(partners)
            .where(eq(partners.userId, user.sub))
            .limit(1);
        return row?.id || null;
    }
    /**
     * Helper: Find customer ID for the current authenticated user
     */
    async getCustomerIdForUser(user) {
        const [row] = await db
            .select({ id: customers.id })
            .from(customers)
            .where(eq(customers.userId, user.sub))
            .limit(1);
        return row?.id || null;
    }
    /**
     * Auto-generate sequential project number PRJ-YYYY-XXX
     */
    async generateProjectNumber(offset = 0, tx = db) {
        const year = new Date().getFullYear();
        const prefix = `PRJ-${year}-`;
        const [latest] = await tx
            .select({ projectNumber: projects.projectNumber })
            .from(projects)
            .where(sql `${projects.projectNumber} LIKE ${prefix + '%'}`)
            .orderBy(desc(projects.projectNumber))
            .limit(1);
        let nextSeq = 1;
        if (latest?.projectNumber) {
            const parts = latest.projectNumber.split('-');
            const seq = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(seq)) {
                nextSeq = seq + 1;
            }
        }
        return `${prefix}${String(nextSeq + offset).padStart(3, '0')}`;
    }
    /**
     * Auto-generate sequential document number DOC-YYYY-XXX
     */
    async generateDocumentNumber(tx = db) {
        const year = new Date().getFullYear();
        const prefix = `DOC-${year}-`;
        const [latest] = await tx
            .select({ documentNumber: documents.documentNumber })
            .from(documents)
            .where(sql `length(${documents.documentNumber}) = 12 AND ${documents.documentNumber} LIKE ${prefix + '%'}`)
            .orderBy(desc(documents.documentNumber))
            .limit(1);
        let nextSeq = 1;
        if (latest?.documentNumber) {
            const parts = latest.documentNumber.split('-');
            const seq = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(seq)) {
                nextSeq = seq + 1;
            }
        }
        let docNum = `${prefix}${String(nextSeq).padStart(3, '0')}`;
        let exists = await tx.select({ id: documents.id }).from(documents).where(eq(documents.documentNumber, docNum)).limit(1);
        while (exists.length > 0) {
            nextSeq++;
            docNum = `${prefix}${String(nextSeq).padStart(3, '0')}`;
            exists = await tx.select({ id: documents.id }).from(documents).where(eq(documents.documentNumber, docNum)).limit(1);
        }
        return docNum;
    }
    /**
     * Auto-generate sequential event number EVT-YYYY-XXX
     */
    async generateEventNumber(tx = db) {
        const year = new Date().getFullYear();
        const prefix = `EVT-${year}-`;
        const [latest] = await tx
            .select({ eventNumber: planningEvents.eventNumber })
            .from(planningEvents)
            .where(sql `${planningEvents.eventNumber} LIKE ${prefix + '%'}`)
            .orderBy(desc(planningEvents.eventNumber))
            .limit(1);
        let nextSeq = 1;
        if (latest?.eventNumber) {
            const parts = latest.eventNumber.split('-');
            const seq = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(seq)) {
                nextSeq = seq + 1;
            }
        }
        return `${prefix}${String(nextSeq).padStart(3, '0')}`;
    }
    /**
     * Map database project to complete ProjectDto (Admin view)
     */
    mapToProjectDto(project, extra) {
        const specs = project.technicalSpecs || {};
        const c = extra?.customer;
        const p = extra?.partner;
        const customerName = c
            ? `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.companyName
            : null;
        const partnerName = p ? p.companyName || p.contactPerson : null;
        const statusTexts = specs.statusTexts || {
            watErNuGebeurt: 'De voorbereiding en bestellingen zijn in volle gang.',
            watErHiernaKomt: 'Aanvang meubelmakerswerkplaats & voorbereiding.',
            leverweek: 'In overleg te bepalen',
            leverStatus: 'Gepland',
            internalNotes: '',
        };
        const customerActions = specs.customerActions || [
            {
                id: 'act-1',
                title: 'Controleer stroom- en watervoorziening',
                subtitle: 'Zorg voor geaarde 230V wandcontactdoos binnen 2 meter',
                actionType: 'checklist',
                completed: false,
            },
            {
                id: 'act-2',
                title: 'Ondergrond waterpas en stabiel',
                subtitle: 'Tegels of betonvloer conform opgave',
                actionType: 'checklist',
                completed: false,
            },
        ];
        const maxSteps = project.projectType === 'garden_room' ? 7 : 5;
        const productionStep = specs.productionStep || 1;
        return {
            id: project.id,
            projectNumber: project.projectNumber,
            quoteId: project.quoteId,
            quoteVersionId: project.quoteVersionId,
            customerId: project.customerId,
            customerName,
            customerEmail: c?.email || null,
            customerPhone: c?.phone || null,
            partnerId: project.partnerId,
            partnerName,
            projectType: project.projectType,
            name: project.name,
            status: project.status,
            orderStatus: project.orderStatus,
            productionStep,
            agreedBuildPrice: project.agreedBuildPrice != null ? Number(project.agreedBuildPrice) : null,
            contractValue: project.contractValue != null ? Number(project.contractValue) : null,
            progressPercentage: project.progressPercentage,
            deliveryAddress: project.deliveryAddress,
            postalCode: project.postalCode,
            city: project.city,
            deliverySlot: project.deliverySlot || null,
            statusTexts,
            customerActions,
            schouw: specs.schouw || null,
            customerChecklist: specs.customerChecklist || {},
            technicalSpecs: specs,
            weekPlanning: specs.weekPlanning || [],
            renderVersions: specs.renderVersions || [],
            oplevering: specs.oplevering || null,
            milestones: extra?.milestones?.map((m) => projectMilestoneService.mapToDto(m)),
            photos: extra?.photos?.map((ph) => projectPhotoService.mapToDto(ph)),
            documents: extra?.documents?.map((d) => ({
                id: d.id,
                documentNumber: d.documentNumber,
                documentType: d.documentType,
                fileName: d.fileName,
                fileUrl: d.fileUrl,
                fileSizeBytes: d.fileSizeBytes,
                mimeType: d.mimeType,
                isPublicForCustomer: d.isPublicForCustomer,
                isPublicForPartner: d.isPublicForPartner,
                createdAt: d.createdAt.toISOString(),
            })),
            invoicesCount: extra?.invoicesCount ?? 0,
            createdAt: project.createdAt.toISOString(),
            updatedAt: project.updatedAt.toISOString(),
        };
    }
    /**
     * Map to Partner Project DTO (Strict financial redaction)
     */
    mapToPartnerDto(fullDto) {
        return {
            id: fullDto.id,
            projectNumber: fullDto.projectNumber,
            partnerId: fullDto.partnerId,
            partnerName: fullDto.partnerName,
            projectType: fullDto.projectType,
            name: fullDto.name,
            status: fullDto.status,
            orderStatus: fullDto.orderStatus,
            productionStep: fullDto.productionStep,
            agreedBuildPrice: fullDto.agreedBuildPrice, // Partners CAN see their own agreed fee
            // contractValue, profit margins, cost price, and internal admin notes are strictly REDACTED
            progressPercentage: fullDto.progressPercentage,
            deliveryAddress: fullDto.deliveryAddress,
            postalCode: fullDto.postalCode,
            city: fullDto.city,
            customerName: fullDto.customerName,
            deliverySlot: fullDto.deliverySlot,
            schouw: fullDto.schouw,
            weekPlanning: fullDto.weekPlanning,
            renderVersions: fullDto.renderVersions,
            milestones: fullDto.milestones,
            photos: fullDto.photos,
            documents: fullDto.documents?.filter((d) => d.isPublicForPartner),
            createdAt: fullDto.createdAt,
            updatedAt: fullDto.updatedAt,
        };
    }
    /**
     * Map to Customer Project DTO (Sanitized, customer-facing)
     */
    mapToCustomerDto(fullDto) {
        // Sanitize status texts to exclude internalNotes
        const sanitizedTexts = {
            watErNuGebeurt: fullDto.statusTexts?.watErNuGebeurt,
            watErHiernaKomt: fullDto.statusTexts?.watErHiernaKomt,
            leverweek: fullDto.statusTexts?.leverweek,
            leverStatus: fullDto.statusTexts?.leverStatus,
        };
        return {
            id: fullDto.id,
            projectNumber: fullDto.projectNumber,
            projectType: fullDto.projectType,
            name: fullDto.name,
            status: fullDto.status,
            orderStatus: fullDto.orderStatus,
            productionStep: fullDto.productionStep,
            progressPercentage: fullDto.progressPercentage,
            deliveryAddress: fullDto.deliveryAddress,
            postalCode: fullDto.postalCode,
            city: fullDto.city,
            deliverySlot: fullDto.deliverySlot,
            statusTexts: sanitizedTexts,
            customerActions: fullDto.customerActions,
            schouw: fullDto.schouw ? { schouwDate: fullDto.schouw.schouwDate, completed: fullDto.schouw.completed } : null,
            customerChecklist: fullDto.customerChecklist || {},
            technicalSpecs: {
                customerChecklist: fullDto.customerChecklist || {},
                schouw: fullDto.schouw,
            },
            renderVersions: fullDto.renderVersions,
            milestones: fullDto.milestones,
            photos: fullDto.photos?.filter((ph) => ph.visibleToCustomer),
            documents: fullDto.documents?.filter((d) => d.isPublicForCustomer),
            createdAt: fullDto.createdAt,
            updatedAt: fullDto.updatedAt,
        };
    }
    /**
     * GET /api/projects
     * Multi-role list with search, filter, pagination
     */
    async listProjects(filter, user) {
        const conditions = [];
        // Role-based scoping
        if (user.role === 'partner') {
            const userPartnerId = await this.getPartnerIdForUser(user);
            if (!userPartnerId) {
                return { data: [], total: 0, page: filter.page, limit: filter.limit, totalPages: 0 };
            }
            conditions.push(eq(projects.partnerId, userPartnerId));
        }
        else if (user.role === 'customer') {
            const userCustomerId = await this.getCustomerIdForUser(user);
            if (!userCustomerId) {
                return { data: [], total: 0, page: filter.page, limit: filter.limit, totalPages: 0 };
            }
            conditions.push(eq(projects.customerId, userCustomerId));
        }
        else {
            // Admin filter options
            if (filter.partnerId)
                conditions.push(eq(projects.partnerId, filter.partnerId));
            if (filter.customerId)
                conditions.push(eq(projects.customerId, filter.customerId));
        }
        if (filter.type)
            conditions.push(eq(projects.projectType, filter.type));
        if (filter.status)
            conditions.push(eq(projects.status, filter.status));
        if (filter.search) {
            const term = `%${filter.search}%`;
            conditions.push(or(ilike(projects.name, term), ilike(projects.projectNumber, term), ilike(projects.city, term), ilike(projects.deliveryAddress, term)));
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        // Count
        const [countResult] = await db
            .select({ count: sql `count(*)::int` })
            .from(projects)
            .where(whereClause);
        const total = countResult?.count || 0;
        // Sorting
        let orderByClause = desc(projects.createdAt);
        if (filter.sort === 'projectNumber:asc')
            orderByClause = asc(projects.projectNumber);
        else if (filter.sort === 'projectNumber:desc')
            orderByClause = desc(projects.projectNumber);
        else if (filter.sort === 'updatedAt:desc')
            orderByClause = desc(projects.updatedAt);
        const rows = await db
            .select({
            project: projects,
            customer: customers,
            partner: partners,
        })
            .from(projects)
            .leftJoin(customers, eq(projects.customerId, customers.id))
            .leftJoin(partners, eq(projects.partnerId, partners.id))
            .where(whereClause)
            .orderBy(orderByClause)
            .limit(filter.limit)
            .offset((filter.page - 1) * filter.limit);
        const mapped = rows.map((r) => {
            const full = this.mapToProjectDto(r.project, { customer: r.customer, partner: r.partner });
            if (user.role === 'partner')
                return this.mapToPartnerDto(full);
            if (user.role === 'customer')
                return this.mapToCustomerDto(full);
            return full;
        });
        return {
            data: mapped,
            total,
            page: filter.page,
            limit: filter.limit,
            totalPages: Math.ceil(total / filter.limit) || 1,
        };
    }
    /**
     * GET /api/projects/:id
     */
    async getById(id, user) {
        const [row] = await db
            .select({
            project: projects,
            customer: customers,
            partner: partners,
        })
            .from(projects)
            .leftJoin(customers, eq(projects.customerId, customers.id))
            .leftJoin(partners, eq(projects.partnerId, partners.id))
            .where(eq(projects.id, id))
            .limit(1);
        if (!row) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        // Role-based security checks
        if (user.role === 'partner') {
            const userPartnerId = await this.getPartnerIdForUser(user);
            if (!userPartnerId || row.project.partnerId !== userPartnerId) {
                throw new ProjectError('You are not authorized to view this project', 403, 'FORBIDDEN');
            }
        }
        else if (user.role === 'customer') {
            const userCustomerId = await this.getCustomerIdForUser(user);
            if (!userCustomerId || row.project.customerId !== userCustomerId) {
                throw new ProjectError('You are not authorized to view this project', 403, 'FORBIDDEN');
            }
        }
        // Fetch related milestones, photos, documents, invoice count
        const [milestonesList, photosList, docsList, [invCount]] = await Promise.all([
            db.select().from(projectMilestones).where(eq(projectMilestones.projectId, id)).orderBy(asc(projectMilestones.sequenceOrder)),
            db.select().from(projectPhotos).where(eq(projectPhotos.projectId, id)).orderBy(desc(projectPhotos.createdAt)),
            db.select().from(documents).where(eq(documents.projectId, id)).orderBy(desc(documents.createdAt)),
            db.select({ count: sql `count(*)::int` }).from(invoices).where(eq(invoices.projectId, id)),
        ]);
        const full = this.mapToProjectDto(row.project, {
            customer: row.customer,
            partner: row.partner,
            milestones: milestonesList,
            photos: photosList,
            documents: docsList,
            invoicesCount: invCount?.count || 0,
        });
        if (user.role === 'partner')
            return this.mapToPartnerDto(full);
        if (user.role === 'customer')
            return this.mapToCustomerDto(full);
        return full;
    }
    /**
     * POST /api/projects (Direct Creation)
     */
    async createProject(data, user) {
        const projectNumber = await this.generateProjectNumber();
        const maxSteps = data.projectType === 'garden_room' ? 7 : 5;
        const step = Math.min(maxSteps, Math.max(1, data.productionStep || 1));
        const progress = Math.round((step / maxSteps) * 100);
        const initialSpecs = {
            productionStep: step,
            statusTexts: {
                watErNuGebeurt: 'De voorbereiding en bestellingen zijn in volle gang.',
                watErHiernaKomt: 'Aanvang meubelmakerswerkplaats & voorbereiding.',
                leverweek: 'In overleg te bepalen',
                leverStatus: 'Gepland',
                internalNotes: '',
            },
            customerActions: [
                {
                    id: 'act-1',
                    title: 'Controleer stroom- en watervoorziening',
                    subtitle: 'Zorg voor geaarde 230V wandcontactdoos binnen 2 meter',
                    actionType: 'checklist',
                    completed: false,
                },
                {
                    id: 'act-2',
                    title: 'Ondergrond waterpas en stabiel',
                    subtitle: 'Tegels of betonvloer conform opgave',
                    actionType: 'checklist',
                    completed: false,
                },
            ],
            ...data.technicalSpecs,
        };
        const newProjectId = await db.transaction(async (tx) => {
            const [newProject] = await tx
                .insert(projects)
                .values({
                projectNumber,
                quoteId: data.quoteId || null,
                quoteVersionId: data.quoteVersionId || null,
                customerId: data.customerId,
                partnerId: data.partnerId || null,
                projectType: data.projectType,
                name: data.name,
                status: 'in_progress',
                orderStatus: data.orderStatus || 'in_voorbereiding',
                contractValue: data.contractValue != null ? sql `${data.contractValue}::numeric` : null,
                agreedBuildPrice: data.agreedBuildPrice != null ? sql `${data.agreedBuildPrice}::numeric` : null,
                progressPercentage: progress,
                deliveryAddress: data.deliveryAddress,
                postalCode: data.postalCode || null,
                city: data.city,
                technicalSpecs: initialSpecs,
            })
                .returning();
            // Automatically initialize default milestones
            const defaultMilestones = data.projectType === 'garden_room'
                ? [
                    { code: 'MS-1-AKKOORD', title: '1. Akkoord & ontwerp', seq: 1 },
                    { code: 'MS-2-SCHOUW', title: '2. Schouw & inmeten op locatie', seq: 2 },
                    { code: 'MS-3-VOORBEREIDING', title: '3. Voorbereiding werkplaats', seq: 3 },
                    { code: 'MS-4-BOUW', title: '4. Start bouw op locatie', seq: 4 },
                    { code: 'MS-5-OPLEVERING', title: '5. Oplevering & opleverrapport', seq: 5 },
                ]
                : [
                    { code: 'MS-1-AKKOORD', title: '1. Akkoord & ontwerp', seq: 1 },
                    { code: 'MS-2-WERKPLAATS', title: '2. In de werkplaats', seq: 2 },
                    { code: 'MS-3-LEVERING', title: '3. Klaar voor levering', seq: 3 },
                    { code: 'MS-4-MONTAGE', title: '4. Geleverd & gemonteerd', seq: 4 },
                    { code: 'MS-5-NAZORG', title: '5. Nazorg & afronding', seq: 5 },
                ];
            for (const m of defaultMilestones) {
                await tx.insert(projectMilestones).values({
                    projectId: newProject.id,
                    milestoneCode: m.code,
                    title: m.title,
                    sequenceOrder: m.seq,
                    status: m.seq === 1 ? 'completed' : 'pending',
                    completedAt: m.seq === 1 ? new Date() : null,
                });
            }
            return newProject.id;
        });
        // Called AFTER the transaction commits so the committed row is visible
        return (await this.getById(newProjectId, user));
    }
    /**
     * PUT /api/projects/:id
     */
    async updateProject(id, data, user) {
        const [existing] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (!existing) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        const updateValues = {
            updatedAt: new Date(),
        };
        if (data.name !== undefined)
            updateValues.name = data.name;
        if (data.customerId !== undefined)
            updateValues.customerId = data.customerId;
        if (data.partnerId !== undefined)
            updateValues.partnerId = data.partnerId;
        if (data.deliveryAddress !== undefined)
            updateValues.deliveryAddress = data.deliveryAddress;
        if (data.postalCode !== undefined)
            updateValues.postalCode = data.postalCode;
        if (data.city !== undefined)
            updateValues.city = data.city;
        if (data.contractValue !== undefined) {
            updateValues.contractValue = data.contractValue != null ? sql `${data.contractValue}::numeric` : null;
        }
        if (data.agreedBuildPrice !== undefined) {
            updateValues.agreedBuildPrice = data.agreedBuildPrice != null ? sql `${data.agreedBuildPrice}::numeric` : null;
        }
        if (data.progressPercentage !== undefined)
            updateValues.progressPercentage = data.progressPercentage;
        if (data.orderStatus !== undefined)
            updateValues.orderStatus = data.orderStatus;
        if (data.technicalSpecs !== undefined) {
            updateValues.technicalSpecs = { ...(existing.technicalSpecs || {}), ...data.technicalSpecs };
        }
        await db.update(projects).set(updateValues).where(eq(projects.id, id));
        return (await this.getById(id, user));
    }
    /**
     * DELETE /api/projects/:id
     * Soft-deletion & cancellation: Never hard-delete projects linked to legal invoices/contracts!
     */
    async softDeleteProject(id, user) {
        const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (!project) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        // Check if project is linked to invoices
        const [inv] = await db.select({ count: sql `count(*)::int` }).from(invoices).where(eq(invoices.projectId, id));
        const invoiceCount = inv?.count || 0;
        if (invoiceCount > 0) {
            // Must soft-cancel to preserve financial and audit history!
            await db.transaction(async (tx) => {
                await tx
                    .update(projects)
                    .set({
                    status: 'cancelled',
                    orderStatus: 'geannuleerd',
                    updatedAt: new Date(),
                })
                    .where(eq(projects.id, id));
                // Mark open milestones as cancelled
                await tx
                    .update(projectMilestones)
                    .set({ status: 'pending', updatedAt: new Date() })
                    .where(eq(projectMilestones.projectId, id));
            });
            return {
                success: true,
                message: 'Project has linked financial invoices and was safely soft-cancelled (status = cancelled). Legal records preserved.',
            };
        }
        // No financial records exist; can be cancelled safely
        await db
            .update(projects)
            .set({
            status: 'cancelled',
            orderStatus: 'geannuleerd',
            updatedAt: new Date(),
        })
            .where(eq(projects.id, id));
        return {
            success: true,
            message: 'Project cancelled successfully.',
        };
    }
    /**
     * PATCH /api/projects/:id/status
     * Advance production step and update top-level status
     */
    async updateStatus(id, input, user) {
        const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (!project) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        const currentSpecs = project.technicalSpecs || {};
        const maxSteps = project.projectType === 'garden_room' ? 7 : 5;
        // Strict production step validation
        if (input.productionStep !== undefined) {
            if (project.projectType === 'outdoor_kitchen' && (input.productionStep < 1 || input.productionStep > 5)) {
                throw new ProjectError('Invalid production step for outdoor kitchen. Must be between 1 and 5.', 400, 'INVALID_PRODUCTION_STEP');
            }
            if (project.projectType === 'garden_room' && (input.productionStep < 1 || input.productionStep > 7)) {
                throw new ProjectError('Invalid production step for garden room. Must be between 1 and 7.', 400, 'INVALID_PRODUCTION_STEP');
            }
            // Approved Decision #3: Garden Room Oplevering Gate
            // Garden Room must NOT advance from Phase 6 Oplevering to Phase 7 Nazorg until handover checklist is complete, signature captured, Opleverrapport PDF generated & stored
            if (project.projectType === 'garden_room' && input.productionStep === 7) {
                const oplevering = currentSpecs.oplevering;
                if (!oplevering || !oplevering.signatureDataUrl || !oplevering.documentId) {
                    throw new ProjectError('Cannot advance Garden Room to Phase 7 (Nazorg). Handover (Oplevering) checklist must be completed and officially signed with an Opleverrapport PDF first.', 400, 'OPLEVERING_NOT_COMPLETED');
                }
            }
        }
        const nextStep = input.productionStep !== undefined ? input.productionStep : currentSpecs.productionStep || 1;
        const progress = input.progressPercentage !== undefined ? input.progressPercentage : Math.round((nextStep / maxSteps) * 100);
        const updateValues = {
            progressPercentage: progress,
            updatedAt: new Date(),
        };
        if (input.status)
            updateValues.status = input.status;
        else if (nextStep === maxSteps)
            updateValues.status = 'completed';
        if (input.orderStatus)
            updateValues.orderStatus = input.orderStatus;
        // Update specs
        currentSpecs.productionStep = nextStep;
        updateValues.technicalSpecs = currentSpecs;
        await db.update(projects).set(updateValues).where(eq(projects.id, id));
        return (await this.getById(id, user));
    }
    /**
     * PATCH /api/projects/:id/status-texts
     */
    async updateStatusTexts(id, texts, user) {
        const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (!project) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        const currentSpecs = project.technicalSpecs || {};
        currentSpecs.statusTexts = {
            ...(currentSpecs.statusTexts || {}),
            ...texts,
        };
        await db
            .update(projects)
            .set({ technicalSpecs: currentSpecs, updatedAt: new Date() })
            .where(eq(projects.id, id));
        return (await this.getById(id, user));
    }
    /**
     * POST /api/projects/:id/customer-actions
     */
    async addCustomerAction(id, action, user) {
        const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (!project) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        const currentSpecs = project.technicalSpecs || {};
        const actions = currentSpecs.customerActions || [];
        const newAction = {
            id: `act-${Date.now()}`,
            title: action.title,
            subtitle: action.subtitle,
            actionType: action.actionType,
            dueDate: action.dueDate,
            completed: false,
        };
        actions.push(newAction);
        currentSpecs.customerActions = actions;
        await db.update(projects).set({ technicalSpecs: currentSpecs, updatedAt: new Date() }).where(eq(projects.id, id));
        return (await this.getById(id, user));
    }
    /**
     * PATCH /api/projects/:id/customer-actions/:actionId
     */
    async updateCustomerAction(id, actionId, data, user) {
        const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (!project) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        const currentSpecs = project.technicalSpecs || {};
        const actions = currentSpecs.customerActions || [];
        const target = actions.find((a) => a.id === actionId);
        if (!target) {
            throw new ProjectError('Customer action item not found', 404, 'NOT_FOUND');
        }
        if (data.title !== undefined)
            target.title = data.title;
        if (data.subtitle !== undefined)
            target.subtitle = data.subtitle;
        if (data.actionType !== undefined)
            target.actionType = data.actionType;
        if (data.dueDate !== undefined)
            target.dueDate = data.dueDate || undefined;
        if (data.completed !== undefined) {
            target.completed = data.completed;
            target.completedAt = data.completed ? new Date().toISOString() : null;
        }
        await db.update(projects).set({ technicalSpecs: currentSpecs, updatedAt: new Date() }).where(eq(projects.id, id));
        return (await this.getById(id, user));
    }
    /**
     * DELETE /api/projects/:id/customer-actions/:actionId
     */
    async deleteCustomerAction(id, actionId, user) {
        const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (!project) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        const currentSpecs = project.technicalSpecs || {};
        const actions = currentSpecs.customerActions || [];
        currentSpecs.customerActions = actions.filter((a) => a.id !== actionId);
        await db.update(projects).set({ technicalSpecs: currentSpecs, updatedAt: new Date() }).where(eq(projects.id, id));
        return (await this.getById(id, user));
    }
    /**
     * PUT /api/projects/:id/delivery-slot
     * Admin proposes delivery slot (Approved Decision #2: transactional, sets tentative planning event)
     */
    async proposeDeliverySlot(id, data, user) {
        const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (!project) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        const deliverySlot = {
            proposedDate: data.proposedDate,
            timeWindow: data.timeWindow || '08:00 - 12:00',
            notes: data.notes,
            status: 'tentative', // Tentative proposal waiting for customer confirmation
        };
        await db.transaction(async (tx) => {
            // 1. Update project delivery slot
            await tx
                .update(projects)
                .set({ deliverySlot, updatedAt: new Date() })
                .where(eq(projects.id, id));
            // 2. Create or update linked planning_events record with status = 'scheduled' (tentative)
            const [existingEvent] = await tx
                .select()
                .from(planningEvents)
                .where(and(eq(planningEvents.projectId, id), eq(planningEvents.eventType, 'single_day_delivery')))
                .limit(1);
            const startTime = new Date(`${data.proposedDate}T08:00:00Z`);
            const endTime = new Date(`${data.proposedDate}T12:00:00Z`);
            if (existingEvent) {
                await tx
                    .update(planningEvents)
                    .set({
                    startTime,
                    endTime,
                    status: 'scheduled',
                    partnerId: project.partnerId,
                    description: `Proposed delivery window: ${deliverySlot.timeWindow}. Notes: ${data.notes || ''}`,
                    updatedAt: new Date(),
                })
                    .where(eq(planningEvents.id, existingEvent.id));
            }
            else {
                const eventNumber = await this.generateEventNumber(tx);
                await tx.insert(planningEvents).values({
                    eventNumber,
                    projectId: id,
                    partnerId: project.partnerId,
                    createdByUserId: user.sub,
                    eventType: 'single_day_delivery',
                    calendarLane: 'delivery_lane',
                    title: `Levering & Montage - ${project.projectNumber}`,
                    description: `Voorgestelde bezorging: ${deliverySlot.timeWindow}. Notes: ${data.notes || ''}`,
                    startTime,
                    endTime,
                    status: 'scheduled', // Represents tentative slot in postgres enum
                    location: `${project.deliveryAddress}, ${project.city}`,
                });
            }
        });
        return (await this.getById(id, user));
    }
    /**
     * POST /api/customer/projects/:id/delivery-slot/confirm
     * Customer confirms delivery slot (Approved Decision #2: updates project and planning event to confirmed)
     */
    async confirmDeliverySlot(id, user, proposedDateOverride, timeSlotOverride) {
        const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (!project) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        if (user.role === 'customer') {
            const userCustomerId = await this.getCustomerIdForUser(user);
            if (!userCustomerId || project.customerId !== userCustomerId) {
                throw new ProjectError('You are not authorized to confirm delivery for this project', 403, 'FORBIDDEN');
            }
        }
        const slot = project.deliverySlot || {};
        if (!slot.proposedDate) {
            slot.proposedDate = proposedDateOverride || '2026-09-15';
            slot.proposedTimeSlot = timeSlotOverride || '13:00 - 16:00';
        }
        slot.status = 'confirmed';
        slot.confirmedAt = new Date().toISOString();
        slot.confirmedBy = user.role;
        await db.transaction(async (tx) => {
            // 1. Update project delivery slot
            await tx
                .update(projects)
                .set({ deliverySlot: slot, updatedAt: new Date() })
                .where(eq(projects.id, id));
            // 2. Update linked planning event to status = 'confirmed'
            await tx
                .update(planningEvents)
                .set({
                status: 'confirmed',
                updatedAt: new Date(),
            })
                .where(and(eq(planningEvents.projectId, id), eq(planningEvents.eventType, 'single_day_delivery')));
        });
        return (await this.getById(id, user));
    }
    /**
     * POST /api/customer/projects/:id/schouw/confirm
     * Customer confirms site survey appointment
     */
    async confirmSchouw(id, user, surveyDate, timeSlot) {
        const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (!project) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        if (user.role === 'customer') {
            const userCustomerId = await this.getCustomerIdForUser(user);
            if (!userCustomerId || project.customerId !== userCustomerId) {
                throw new ProjectError('You are not authorized to confirm site survey for this project', 403, 'FORBIDDEN');
            }
        }
        const currentSpecs = project.technicalSpecs || {};
        currentSpecs.schouw = {
            ...(currentSpecs.schouw || {}),
            status: 'confirmed',
            surveyDate: surveyDate || (currentSpecs.schouw?.surveyDate || '2026-08-27'),
            timeSlot: timeSlot || (currentSpecs.schouw?.timeSlot || '09:00 - 11:00'),
            confirmedAt: new Date().toISOString(),
            confirmedBy: user.role,
        };
        await db.update(projects).set({ technicalSpecs: currentSpecs, updatedAt: new Date() }).where(eq(projects.id, id));
        return (await this.getById(id, user));
    }
    /**
     * PUT /api/projects/:id/schouw
     */
    async updateSchouw(id, schouwData, user) {
        const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (!project) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        const currentSpecs = project.technicalSpecs || {};
        currentSpecs.schouw = {
            ...(currentSpecs.schouw || {}),
            ...schouwData,
        };
        await db.update(projects).set({ technicalSpecs: currentSpecs, updatedAt: new Date() }).where(eq(projects.id, id));
        return (await this.getById(id, user));
    }
    /**
     * PUT /api/projects/:id/week-planning
     */
    async updateWeekPlanning(id, weeks, user) {
        const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (!project) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        const currentSpecs = project.technicalSpecs || {};
        currentSpecs.weekPlanning = weeks.map((w, idx) => ({
            id: w.id || `week-${idx + 1}`,
            weekNumber: w.weekNumber,
            phase: w.phase,
            status: w.status,
            notes: w.notes,
        }));
        await db.update(projects).set({ technicalSpecs: currentSpecs, updatedAt: new Date() }).where(eq(projects.id, id));
        return (await this.getById(id, user));
    }
    /**
     * POST /api/projects/:id/render-versions
     */
    async addRenderVersion(id, data, user) {
        const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (!project) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        const currentSpecs = project.technicalSpecs || {};
        const versions = currentSpecs.renderVersions || [];
        const vNum = data.versionNumber || versions.length + 1;
        // If marked live, unset isLive on others
        if (data.isLive) {
            versions.forEach((v) => (v.isLive = false));
        }
        const newVersion = {
            id: `v-${Date.now()}`,
            versionNumber: vNum,
            title: data.title,
            woodColor: data.woodColor,
            notes: data.notes,
            isLive: data.isLive ?? versions.length === 0,
            createdAt: new Date().toISOString(),
            images: data.images || [],
            feedback: [],
        };
        versions.push(newVersion);
        currentSpecs.renderVersions = versions;
        await db.update(projects).set({ technicalSpecs: currentSpecs, updatedAt: new Date() }).where(eq(projects.id, id));
        return (await this.getById(id, user));
    }
    /**
     * PATCH /api/projects/:id/render-versions/:versionId/set-live
     */
    async setRenderVersionLive(id, versionId, user) {
        const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (!project) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        const currentSpecs = project.technicalSpecs || {};
        const versions = currentSpecs.renderVersions || [];
        let found = false;
        versions.forEach((v) => {
            if (v.id === versionId) {
                v.isLive = true;
                found = true;
            }
            else {
                v.isLive = false;
            }
        });
        if (!found) {
            throw new ProjectError('Render version not found', 404, 'NOT_FOUND');
        }
        await db.update(projects).set({ technicalSpecs: currentSpecs, updatedAt: new Date() }).where(eq(projects.id, id));
        return (await this.getById(id, user));
    }
    /**
     * POST /api/customer/projects/:id/render-feedback
     */
    async addRenderFeedback(id, feedback, user) {
        const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (!project) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        if (user.role === 'customer') {
            const userCustomerId = await this.getCustomerIdForUser(user);
            if (!userCustomerId || project.customerId !== userCustomerId) {
                throw new ProjectError('You are not authorized to submit feedback for this project', 403, 'FORBIDDEN');
            }
        }
        const currentSpecs = project.technicalSpecs || {};
        const versions = currentSpecs.renderVersions || [];
        const target = versions.find((v) => v.id === feedback.renderVersionId);
        if (!target) {
            throw new ProjectError('Target render version not found', 404, 'NOT_FOUND');
        }
        if (!target.feedback)
            target.feedback = [];
        target.feedback.push({
            id: `fb-${Date.now()}`,
            comment: feedback.comment,
            createdAt: new Date().toISOString(),
            customerName: user.fullName || 'Klant',
        });
        await db.update(projects).set({ technicalSpecs: currentSpecs, updatedAt: new Date() }).where(eq(projects.id, id));
        return (await this.getById(id, user));
    }
    /**
     * PATCH /api/customer/projects/:id/checklist/:itemId
     */
    async updateCustomerChecklist(id, itemId, completed, user) {
        const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (!project) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        if (user.role === 'customer') {
            const userCustomerId = await this.getCustomerIdForUser(user);
            if (!userCustomerId || project.customerId !== userCustomerId) {
                throw new ProjectError('You are not authorized to update checklist for this project', 403, 'FORBIDDEN');
            }
        }
        const currentSpecs = project.technicalSpecs || {};
        const checklist = currentSpecs.customerChecklist || {};
        checklist[itemId] = completed;
        currentSpecs.customerChecklist = checklist;
        await db.update(projects).set({ technicalSpecs: currentSpecs, updatedAt: new Date() }).where(eq(projects.id, id));
        return (await this.getById(id, user));
    }
    /**
     * POST /api/projects/:id/oplevering
     * Complete Handover checklist, sign, generate PDF & store in documents (Approved Decision #3: Transactional)
     */
    async completeOplevering(id, input, user) {
        const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (!project) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        const fullProject = (await this.getById(id, user));
        const completedAtIso = new Date().toISOString();
        const opleveringData = {
            checklist: input.checklist,
            signeeName: input.signeeName,
            signatureDataUrl: input.signatureDataUrl,
            completedAt: completedAtIso,
            notes: input.notes,
        };
        // 1. Generate Opleverrapport PDF Buffer
        const { buffer, fileName } = projectPdfService.generateOpleverrapportPdf(fullProject, opleveringData);
        // 2. Save PDF file to storage
        const saved = await storageService.saveBuffer(`projects/${id}/documents`, fileName, buffer, 'application/pdf');
        const result = await db.transaction(async (tx) => {
            // 3. Insert into documents table
            const docNum = await this.generateDocumentNumber(tx);
            const [newDoc] = await tx
                .insert(documents)
                .values({
                documentNumber: docNum,
                documentType: 'opleverrapport_pdf',
                fileName,
                fileUrl: saved.filePath,
                fileSizeBytes: saved.fileSizeBytes,
                mimeType: 'application/pdf',
                projectId: id,
                isPublicForCustomer: true,
                isPublicForPartner: true,
                uploadedByUserId: user.sub,
            })
                .returning();
            // 4. Update project technical specs with oplevering data and document reference
            opleveringData.documentId = newDoc.id;
            opleveringData.pdfUrl = `/api/documents/${newDoc.id}/download`;
            const currentSpecs = project.technicalSpecs || {};
            currentSpecs.oplevering = opleveringData;
            // Also advance production step to Oplevering (Step 6 for Garden Room, Step 4 for Outdoor Kitchen)
            const opleveringStep = project.projectType === 'garden_room' ? 6 : 4;
            currentSpecs.productionStep = Math.max(currentSpecs.productionStep || 1, opleveringStep);
            await tx
                .update(projects)
                .set({
                technicalSpecs: currentSpecs,
                orderStatus: 'opgeleverd',
                updatedAt: new Date(),
            })
                .where(eq(projects.id, id));
            return {
                success: true,
                documentId: newDoc.id,
                pdfUrl: opleveringData.pdfUrl,
            };
        });
        const updatedProject = (await this.getById(id, user));
        return {
            success: result.success,
            documentId: result.documentId,
            pdfUrl: result.pdfUrl,
            project: updatedProject,
        };
    }
    /**
     * GET /api/projects/:id/werkorder-pdf
     */
    async generateWerkorderPdf(id, user) {
        const project = (await this.getById(id, user));
        return projectPdfService.generateWerkorderPdf(project);
    }
    /**
     * PATCH /api/projects/:id/assign-partner
     */
    async assignPartner(id, partnerId, agreedBuildPrice, user) {
        const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (!project) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        const [partner] = await db.select().from(partners).where(eq(partners.id, partnerId)).limit(1);
        if (!partner) {
            throw new ProjectError('Partner not found', 404, 'PARTNER_NOT_FOUND');
        }
        await db.transaction(async (tx) => {
            await tx
                .update(projects)
                .set({
                partnerId,
                agreedBuildPrice: sql `${agreedBuildPrice}::numeric`,
                updatedAt: new Date(),
            })
                .where(eq(projects.id, id));
            // Update partner ID in planning events linked to this project
            await tx
                .update(planningEvents)
                .set({ partnerId, updatedAt: new Date() })
                .where(eq(planningEvents.projectId, id));
        });
        return (await this.getById(id, user));
    }
    /**
     * POST /api/projects/:id/documents
     */
    async createDocument(id, data, user) {
        const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
        if (!project) {
            throw new ProjectError('Project not found', 404, 'NOT_FOUND');
        }
        const docNum = await this.generateDocumentNumber();
        const [created] = await db
            .insert(documents)
            .values({
            documentNumber: docNum,
            documentType: data.documentType || 'cad_blueprint',
            fileName: data.fileName,
            fileUrl: data.fileUrl,
            fileSizeBytes: data.fileSizeBytes || null,
            mimeType: data.mimeType || 'application/pdf',
            projectId: id,
            isPublicForCustomer: data.isPublicForCustomer ?? false,
            isPublicForPartner: data.isPublicForPartner ?? true,
            uploadedByUserId: user.sub,
        })
            .returning();
        return created;
    }
}
export const projectService = new ProjectService();
