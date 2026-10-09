import { eq, or, ilike, sql, desc, asc, and, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { leads, leadVoiceNotes, commercialActions, tasks, customers, users, partnerPriceRequests, partnerOffers, quotes, } from '../../db/schema.js';
import { customerService } from '../customers/customer.service.js';
export class LeadError extends Error {
    statusCode;
    code;
    constructor(message, statusCode = 400, code = 'LEAD_ERROR') {
        super(message);
        this.name = 'LeadError';
        this.statusCode = statusCode;
        this.code = code;
    }
}
export class LeadService {
    /**
     * Generates a unique sequential lead number in format LEAD-YYYY-XXX
     */
    async generateLeadNumber() {
        const year = new Date().getFullYear();
        const prefix = `LEAD-${year}-`;
        const [latest] = await db
            .select({ leadNumber: leads.leadNumber })
            .from(leads)
            .where(ilike(leads.leadNumber, `${prefix}%`))
            .orderBy(desc(leads.leadNumber))
            .limit(1);
        if (!latest) {
            return `${prefix}001`;
        }
        const currentNumber = parseInt(latest.leadNumber.replace(prefix, ''), 10);
        const nextSeq = isNaN(currentNumber) ? 1 : currentNumber + 1;
        return `${prefix}${nextSeq.toString().padStart(3, '0')}`;
    }
    /**
     * Generates a unique sequential task number in format TSK-YYYY-XXX
     */
    async generateTaskNumber() {
        const year = new Date().getFullYear();
        const prefix = `TSK-${year}-`;
        const [latest] = await db
            .select({ taskNumber: tasks.taskNumber })
            .from(tasks)
            .where(ilike(tasks.taskNumber, `${prefix}%`))
            .orderBy(desc(tasks.taskNumber))
            .limit(1);
        if (!latest) {
            return `${prefix}001`;
        }
        const currentNumber = parseInt(latest.taskNumber.replace(prefix, ''), 10);
        const nextSeq = isNaN(currentNumber) ? 1 : currentNumber + 1;
        return `${prefix}${nextSeq.toString().padStart(3, '0')}`;
    }
    /**
     * List leads with search, filters, sorting, and pagination
     */
    async list(params) {
        const page = params.page || 1;
        const limit = params.limit || 20;
        const offset = (page - 1) * limit;
        const conditions = [];
        if (params.search) {
            const term = `%${params.search.trim()}%`;
            conditions.push(or(ilike(leads.name, term), ilike(leads.email, term), ilike(leads.phone, term), ilike(leads.city, term), ilike(leads.leadNumber, term)));
        }
        if (params.status && params.status !== 'All') {
            conditions.push(eq(leads.status, params.status));
        }
        if (params.workflowStep) {
            conditions.push(eq(leads.workflowStep, params.workflowStep));
        }
        if (params.productType) {
            conditions.push(eq(leads.productType, params.productType));
        }
        if (params.assignedToUserId) {
            conditions.push(eq(leads.assignedToUserId, params.assignedToUserId));
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        // Total count
        const [countResult] = await db
            .select({ count: sql `count(*)::int` })
            .from(leads)
            .where(whereClause);
        const total = countResult?.count || 0;
        // Sort order
        let orderExpr = desc(leads.createdAt);
        if (params.sortBy === 'name') {
            orderExpr = params.sortOrder === 'asc' ? asc(leads.name) : desc(leads.name);
        }
        else if (params.sortBy === 'workflowStep') {
            orderExpr = params.sortOrder === 'asc' ? asc(leads.workflowStep) : desc(leads.workflowStep);
        }
        else if (params.sortBy === 'status') {
            orderExpr = params.sortOrder === 'asc' ? asc(leads.status) : desc(leads.status);
        }
        else {
            orderExpr = params.sortOrder === 'asc' ? asc(leads.createdAt) : desc(leads.createdAt);
        }
        const rows = await db
            .select({
            lead: leads,
            assignedUser: {
                fullName: users.fullName,
            },
            intakeNote: sql `(
          SELECT note FROM commercial_actions 
          WHERE lead_id = ${leads.id} AND action_type = 'intake_note' 
          ORDER BY created_at ASC LIMIT 1
        )`,
        })
            .from(leads)
            .leftJoin(users, eq(leads.assignedToUserId, users.id))
            .where(whereClause)
            .orderBy(orderExpr)
            .limit(limit)
            .offset(offset);
        const items = rows.map((r) => ({
            id: r.lead.id,
            leadNumber: r.lead.leadNumber,
            customerId: r.lead.customerId,
            name: r.lead.name,
            email: r.lead.email,
            phone: r.lead.phone,
            address: r.lead.address,
            city: r.lead.city,
            productType: r.lead.productType,
            dimensionsInquiry: r.lead.dimensionsInquiry,
            source: r.lead.source,
            status: r.lead.status,
            workflowStep: r.lead.workflowStep,
            assignedToUserId: r.lead.assignedToUserId,
            assignedToName: r.assignedUser?.fullName,
            lostReason: r.lead.lostReason,
            notes: r.intakeNote || null,
            intakeNotes: r.intakeNote || null,
            createdAt: r.lead.createdAt.toISOString(),
            updatedAt: r.lead.updatedAt.toISOString(),
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
     * Retrieves complete Lead Dossier with voice notes, commercial actions, and linked customer
     */
    async getDossier(id) {
        const [leadRow] = await db
            .select({
            lead: leads,
            assignedUser: {
                fullName: users.fullName,
            },
        })
            .from(leads)
            .leftJoin(users, eq(leads.assignedToUserId, users.id))
            .where(eq(leads.id, id))
            .limit(1);
        if (!leadRow) {
            throw new LeadError('Lead not found', 404, 'LEAD_NOT_FOUND');
        }
        // 1. Voice Notes
        const voiceNotesRows = await db
            .select({
            note: leadVoiceNotes,
            uploader: {
                fullName: users.fullName,
            },
        })
            .from(leadVoiceNotes)
            .leftJoin(users, eq(leadVoiceNotes.uploadedByUserId, users.id))
            .where(eq(leadVoiceNotes.leadId, id))
            .orderBy(desc(leadVoiceNotes.recordingDate));
        // 2. Commercial Actions with linked task
        const actionsRows = await db
            .select({
            action: commercialActions,
            creator: {
                fullName: users.fullName,
            },
            task: tasks,
        })
            .from(commercialActions)
            .leftJoin(users, eq(commercialActions.createdByUserId, users.id))
            .leftJoin(tasks, eq(commercialActions.linkedTaskId, tasks.id))
            .where(eq(commercialActions.leadId, id))
            .orderBy(desc(commercialActions.actionDate));
        // 3. Customer if converted
        let linkedCustomer = null;
        if (leadRow.lead.customerId) {
            const [cust] = await db
                .select()
                .from(customers)
                .where(eq(customers.id, leadRow.lead.customerId))
                .limit(1);
            if (cust) {
                linkedCustomer = {
                    id: cust.id,
                    customerNumber: cust.customerNumber,
                    firstName: cust.firstName,
                    lastName: cust.lastName,
                    email: cust.email,
                    phone: cust.phone,
                    city: cust.city,
                };
            }
        }
        const voiceNotes = voiceNotesRows.map((v) => ({
            id: v.note.id,
            leadId: v.note.leadId,
            uploadedByUserId: v.note.uploadedByUserId,
            uploadedByName: v.uploader?.fullName,
            fileName: v.note.fileName,
            fileUrl: v.note.fileUrl,
            durationSeconds: v.note.durationSeconds,
            recordingDate: v.note.recordingDate.toISOString(),
            transcriptText: v.note.transcriptText,
            aiSummary: v.note.aiSummary,
            extractedSpecs: v.note.extractedSpecs,
            createdAt: v.note.createdAt.toISOString(),
        }));
        const commercialActionsList = actionsRows.map((a) => ({
            id: a.action.id,
            leadId: a.action.leadId,
            projectId: a.action.projectId,
            createdByUserId: a.action.createdByUserId,
            createdByName: a.creator?.fullName,
            actionType: a.action.actionType,
            note: a.action.note,
            actionDate: a.action.actionDate.toISOString(),
            linkedTaskId: a.action.linkedTaskId,
            linkedTask: a.task
                ? {
                    id: a.task.id,
                    taskNumber: a.task.taskNumber,
                    title: a.task.title,
                    status: a.task.status,
                    priority: a.task.priority,
                    dueDate: a.task.dueDate,
                }
                : null,
            createdAt: a.action.createdAt.toISOString(),
        }));
        const intakeAction = actionsRows.find((a) => a.action.actionType === 'intake_note');
        const intakeNote = intakeAction?.action.note || null;
        return {
            id: leadRow.lead.id,
            leadNumber: leadRow.lead.leadNumber,
            customerId: leadRow.lead.customerId,
            name: leadRow.lead.name,
            email: leadRow.lead.email,
            phone: leadRow.lead.phone,
            address: leadRow.lead.address,
            city: leadRow.lead.city,
            productType: leadRow.lead.productType,
            dimensionsInquiry: leadRow.lead.dimensionsInquiry,
            source: leadRow.lead.source,
            status: leadRow.lead.status,
            workflowStep: leadRow.lead.workflowStep,
            assignedToUserId: leadRow.lead.assignedToUserId,
            assignedToName: leadRow.assignedUser?.fullName,
            lostReason: leadRow.lead.lostReason,
            notes: intakeNote,
            intakeNotes: intakeNote,
            createdAt: leadRow.lead.createdAt.toISOString(),
            updatedAt: leadRow.lead.updatedAt.toISOString(),
            voiceNotes,
            commercialActions: commercialActionsList,
            customer: linkedCustomer,
        };
    }
    /**
     * Create new lead with optional initial note
     */
    async create(data, currentUserId) {
        const leadNumber = await this.generateLeadNumber();
        const assignedUserId = data.assignedToUserId || currentUserId;
        // Verify assigned user exists
        const [assignedUser] = await db
            .select({ id: users.id, fullName: users.fullName })
            .from(users)
            .where(eq(users.id, assignedUserId))
            .limit(1);
        if (!assignedUser) {
            throw new LeadError('Assigned user does not exist', 400, 'USER_NOT_FOUND');
        }
        const [created] = await db
            .insert(leads)
            .values({
            leadNumber,
            name: data.name,
            email: data.email?.toLowerCase() || null,
            phone: data.phone || null,
            address: data.address || null,
            city: data.city || null,
            productType: data.productType,
            dimensionsInquiry: data.dimensionsInquiry || null,
            source: data.source || 'Direct',
            status: data.status || 'new',
            workflowStep: data.workflowStep || 1,
            assignedToUserId: assignedUserId,
        })
            .returning();
        // If initial notes provided, create first commercial action
        if (data.notes) {
            await db.insert(commercialActions).values({
                leadId: created.id,
                createdByUserId: currentUserId,
                actionType: 'intake_note',
                note: data.notes,
            });
        }
        return {
            id: created.id,
            leadNumber: created.leadNumber,
            customerId: created.customerId,
            name: created.name,
            email: created.email,
            phone: created.phone,
            address: created.address,
            city: created.city,
            productType: created.productType,
            dimensionsInquiry: created.dimensionsInquiry,
            source: created.source,
            status: created.status,
            workflowStep: created.workflowStep,
            assignedToUserId: created.assignedToUserId,
            assignedToName: assignedUser.fullName,
            lostReason: created.lostReason,
            notes: data.notes || null,
            intakeNotes: data.notes || null,
            createdAt: created.createdAt.toISOString(),
            updatedAt: created.updatedAt.toISOString(),
        };
    }
    /**
     * Update lead info
     */
    async update(id, data) {
        const [existing] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
        if (!existing) {
            throw new LeadError('Lead not found', 404, 'LEAD_NOT_FOUND');
        }
        if (data.assignedToUserId) {
            const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, data.assignedToUserId)).limit(1);
            if (!u)
                throw new LeadError('Assigned user does not exist', 400, 'USER_NOT_FOUND');
        }
        const { notes: updatedNotes, ...leadFields } = data;
        if (updatedNotes !== undefined) {
            const [existingNote] = await db
                .select()
                .from(commercialActions)
                .where(and(eq(commercialActions.leadId, id), eq(commercialActions.actionType, 'intake_note')))
                .limit(1);
            if (existingNote) {
                if (updatedNotes) {
                    await db
                        .update(commercialActions)
                        .set({ note: updatedNotes })
                        .where(eq(commercialActions.id, existingNote.id));
                }
                else {
                    await db
                        .delete(commercialActions)
                        .where(eq(commercialActions.id, existingNote.id));
                }
            }
            else if (updatedNotes) {
                await db.insert(commercialActions).values({
                    leadId: id,
                    createdByUserId: existing.assignedToUserId,
                    actionType: 'intake_note',
                    note: updatedNotes,
                });
            }
        }
        const [updated] = await db
            .update(leads)
            .set({
            ...leadFields,
            updatedAt: new Date(),
        })
            .where(eq(leads.id, id))
            .returning();
        const [assignedUser] = await db
            .select({ fullName: users.fullName })
            .from(users)
            .where(eq(users.id, updated.assignedToUserId))
            .limit(1);
        const [intakeAction] = await db
            .select({ note: commercialActions.note })
            .from(commercialActions)
            .where(and(eq(commercialActions.leadId, id), eq(commercialActions.actionType, 'intake_note')))
            .limit(1);
        return {
            id: updated.id,
            leadNumber: updated.leadNumber,
            customerId: updated.customerId,
            name: updated.name,
            email: updated.email,
            phone: updated.phone,
            address: updated.address,
            city: updated.city,
            productType: updated.productType,
            dimensionsInquiry: updated.dimensionsInquiry,
            source: updated.source,
            status: updated.status,
            workflowStep: updated.workflowStep,
            assignedToUserId: updated.assignedToUserId,
            assignedToName: assignedUser?.fullName,
            lostReason: updated.lostReason,
            notes: intakeAction?.note || null,
            intakeNotes: intakeAction?.note || null,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
        };
    }
    /**
     * Advance or set workflow step (1 through 8) with automated status synchronization
     */
    async updateStep(id, step) {
        if (step < 1 || step > 8) {
            throw new LeadError('Workflow step must be between 1 and 8', 400, 'INVALID_STEP');
        }
        const [existing] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
        if (!existing) {
            throw new LeadError('Lead not found', 404, 'LEAD_NOT_FOUND');
        }
        // Determine status synchronization
        let newStatus = existing.status;
        if (existing.status !== 'lost') {
            if (step === 1 && existing.status === 'new') {
                newStatus = 'new';
            }
            else if (step === 2) {
                newStatus = 'in_conversation';
            }
            else if (step === 3) {
                newStatus = 'price_received';
            }
            else if (step === 4 || step === 5) {
                newStatus = 'quote_sent';
            }
            else if (step >= 6) {
                newStatus = 'won';
            }
        }
        const [updated] = await db
            .update(leads)
            .set({
            workflowStep: step,
            status: newStatus,
            updatedAt: new Date(),
        })
            .where(eq(leads.id, id))
            .returning();
        return {
            id: updated.id,
            leadNumber: updated.leadNumber,
            customerId: updated.customerId,
            name: updated.name,
            email: updated.email,
            phone: updated.phone,
            address: updated.address,
            city: updated.city,
            productType: updated.productType,
            dimensionsInquiry: updated.dimensionsInquiry,
            source: updated.source,
            status: updated.status,
            workflowStep: updated.workflowStep,
            assignedToUserId: updated.assignedToUserId,
            lostReason: updated.lostReason,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
        };
    }
    /**
     * Update lead status (e.g. Won, Lost, etc.)
     */
    async updateStatus(id, status, lostReason) {
        const [existing] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
        if (!existing) {
            throw new LeadError('Lead not found', 404, 'LEAD_NOT_FOUND');
        }
        const [updated] = await db
            .update(leads)
            .set({
            status,
            lostReason: status === 'lost' ? lostReason || 'No reason specified' : null,
            updatedAt: new Date(),
        })
            .where(eq(leads.id, id))
            .returning();
        return {
            id: updated.id,
            leadNumber: updated.leadNumber,
            customerId: updated.customerId,
            name: updated.name,
            email: updated.email,
            phone: updated.phone,
            address: updated.address,
            city: updated.city,
            productType: updated.productType,
            dimensionsInquiry: updated.dimensionsInquiry,
            source: updated.source,
            status: updated.status,
            workflowStep: updated.workflowStep,
            assignedToUserId: updated.assignedToUserId,
            lostReason: updated.lostReason,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
        };
    }
    /**
     * Upload / Record Plaud AI Voice Note
     */
    async addVoiceNote(leadId, data, uploadedByUserId) {
        const [existing] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
        if (!existing) {
            throw new LeadError('Lead not found', 404, 'LEAD_NOT_FOUND');
        }
        const [created] = await db
            .insert(leadVoiceNotes)
            .values({
            leadId,
            uploadedByUserId,
            fileName: data.fileName,
            fileUrl: data.fileUrl,
            durationSeconds: data.durationSeconds || null,
            recordingDate: data.recordingDate ? new Date(data.recordingDate) : new Date(),
            transcriptText: data.transcriptText || null,
            aiSummary: data.aiSummary || null,
            extractedSpecs: data.extractedSpecs || null,
        })
            .returning();
        return {
            id: created.id,
            leadId: created.leadId,
            uploadedByUserId: created.uploadedByUserId,
            fileName: created.fileName,
            fileUrl: created.fileUrl,
            durationSeconds: created.durationSeconds,
            recordingDate: created.recordingDate.toISOString(),
            transcriptText: created.transcriptText,
            aiSummary: created.aiSummary,
            extractedSpecs: created.extractedSpecs,
            createdAt: created.createdAt.toISOString(),
        };
    }
    /**
     * Update AI transcript or summary of a voice note
     */
    async updateVoiceNote(leadId, vnId, data) {
        const [existing] = await db
            .select()
            .from(leadVoiceNotes)
            .where(and(eq(leadVoiceNotes.id, vnId), eq(leadVoiceNotes.leadId, leadId)))
            .limit(1);
        if (!existing) {
            throw new LeadError('Voice note not found', 404, 'VOICE_NOTE_NOT_FOUND');
        }
        const [updated] = await db
            .update(leadVoiceNotes)
            .set({
            ...data,
        })
            .where(eq(leadVoiceNotes.id, vnId))
            .returning();
        return {
            id: updated.id,
            leadId: updated.leadId,
            uploadedByUserId: updated.uploadedByUserId,
            fileName: updated.fileName,
            fileUrl: updated.fileUrl,
            durationSeconds: updated.durationSeconds,
            recordingDate: updated.recordingDate.toISOString(),
            transcriptText: updated.transcriptText,
            aiSummary: updated.aiSummary,
            extractedSpecs: updated.extractedSpecs,
            createdAt: updated.createdAt.toISOString(),
        };
    }
    /**
     * Add commercial consultation note and optional follow-up task atomically
     */
    async addCommercialAction(leadId, data, createdByUserId) {
        const [existing] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
        if (!existing) {
            throw new LeadError('Lead not found', 404, 'LEAD_NOT_FOUND');
        }
        let linkedTaskId = null;
        let linkedTaskData = null;
        // Atomic transaction for task creation + commercial action linking
        if (data.createTask) {
            const taskNumber = await this.generateTaskNumber();
            const taskAssignee = data.taskAssigneeUserId || existing.assignedToUserId || createdByUserId;
            const dueDate = data.taskDueDate || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const [taskRow] = await db
                .insert(tasks)
                .values({
                taskNumber,
                title: data.taskTitle || `Follow up: ${existing.name}`,
                description: data.note,
                leadId,
                assignedToUserId: taskAssignee,
                createdByUserId,
                priority: data.taskPriority || 'medium',
                status: 'pending',
                dueDate,
            })
                .returning();
            linkedTaskId = taskRow.id;
            linkedTaskData = {
                id: taskRow.id,
                taskNumber: taskRow.taskNumber,
                title: taskRow.title,
                status: taskRow.status,
                priority: taskRow.priority,
                dueDate: taskRow.dueDate,
            };
        }
        const [actionRow] = await db
            .insert(commercialActions)
            .values({
            leadId,
            createdByUserId,
            actionType: data.actionType || 'consultation_note',
            note: data.note,
            actionDate: data.actionDate ? new Date(data.actionDate) : new Date(),
            linkedTaskId,
        })
            .returning();
        return {
            id: actionRow.id,
            leadId: actionRow.leadId,
            projectId: actionRow.projectId,
            createdByUserId: actionRow.createdByUserId,
            actionType: actionRow.actionType,
            note: actionRow.note,
            actionDate: actionRow.actionDate.toISOString(),
            linkedTaskId: actionRow.linkedTaskId,
            linkedTask: linkedTaskData,
            createdAt: actionRow.createdAt.toISOString(),
        };
    }
    /**
     * Transactional 1-Click Conversion: Converts a Lead into an Active Customer record
     * Prevents duplicate conversion and links customerId.
     */
    async convertToCustomer(leadId) {
        const [leadRecord] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
        if (!leadRecord) {
            throw new LeadError('Lead not found', 404, 'LEAD_NOT_FOUND');
        }
        if (leadRecord.customerId) {
            throw new LeadError('Lead has already been converted to a customer', 409, 'ALREADY_CONVERTED');
        }
        // Split Name into firstName and lastName
        const nameParts = leadRecord.name.trim().split(/\s+/);
        const firstName = nameParts[0] || 'Customer';
        const lastName = nameParts.slice(1).join(' ') || 'Lead';
        let customerIdToLink;
        let customerData;
        // Check if customer with same email already exists in customers table
        if (leadRecord.email) {
            const [existingCust] = await db
                .select()
                .from(customers)
                .where(eq(customers.email, leadRecord.email.toLowerCase()))
                .limit(1);
            if (existingCust) {
                customerIdToLink = existingCust.id;
                customerData = existingCust;
            }
            else {
                const createdCustomer = await customerService.create({
                    firstName,
                    lastName,
                    email: leadRecord.email,
                    phone: leadRecord.phone || '+31 6 00000000',
                    streetAddress: leadRecord.address || null,
                    city: leadRecord.city || 'Amsterdam',
                    country: 'NL',
                    notes: `Converted from lead ${leadRecord.leadNumber} (${leadRecord.name})`,
                });
                customerIdToLink = createdCustomer.id;
                customerData = createdCustomer;
            }
        }
        else {
            const createdCustomer = await customerService.create({
                firstName,
                lastName,
                email: `${leadRecord.name.toLowerCase().replace(/[^a-z0-9]/g, '.')}@client.vanuitambacht.nl`,
                phone: leadRecord.phone || '+31 6 00000000',
                streetAddress: leadRecord.address || null,
                city: leadRecord.city || 'Amsterdam',
                country: 'NL',
                notes: `Converted from lead ${leadRecord.leadNumber} (${leadRecord.name})`,
            });
            customerIdToLink = createdCustomer.id;
            customerData = createdCustomer;
        }
        // Update lead with customerId and advance step to 6 (Customer Approval) / Won if earlier
        const newStep = Math.max(leadRecord.workflowStep, 6);
        const [updatedLead] = await db
            .update(leads)
            .set({
            customerId: customerIdToLink,
            workflowStep: newStep,
            status: 'won',
            updatedAt: new Date(),
        })
            .where(eq(leads.id, leadId))
            .returning();
        return {
            customer: customerData,
            lead: {
                id: updatedLead.id,
                leadNumber: updatedLead.leadNumber,
                customerId: updatedLead.customerId,
                name: updatedLead.name,
                email: updatedLead.email,
                phone: updatedLead.phone,
                address: updatedLead.address,
                city: updatedLead.city,
                productType: updatedLead.productType,
                dimensionsInquiry: updatedLead.dimensionsInquiry,
                source: updatedLead.source,
                status: updatedLead.status,
                workflowStep: updatedLead.workflowStep,
                assignedToUserId: updatedLead.assignedToUserId,
                lostReason: updatedLead.lostReason,
                createdAt: updatedLead.createdAt.toISOString(),
                updatedAt: updatedLead.updatedAt.toISOString(),
            },
        };
    }
    /**
     * Delete lead with safe dependency clean-up
     */
    async delete(id) {
        const [existing] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
        if (!existing) {
            throw new LeadError('Lead not found', 404, 'LEAD_NOT_FOUND');
        }
        await db.transaction(async (tx) => {
            // 1. Handle Partner Price Requests & Offers (RESTRICT constraint on leadId)
            const pprs = await tx
                .select({ id: partnerPriceRequests.id })
                .from(partnerPriceRequests)
                .where(eq(partnerPriceRequests.leadId, id));
            if (pprs.length > 0) {
                const pprIds = pprs.map((p) => p.id);
                const offers = await tx
                    .select({ id: partnerOffers.id })
                    .from(partnerOffers)
                    .where(inArray(partnerOffers.requestId, pprIds));
                if (offers.length > 0) {
                    const offerIds = offers.map((o) => o.id);
                    // Unlink accepted partner offer from quotes if any
                    await tx
                        .update(quotes)
                        .set({ acceptedPartnerOfferId: null })
                        .where(inArray(quotes.acceptedPartnerOfferId, offerIds));
                    // Delete partner offers
                    await tx
                        .delete(partnerOffers)
                        .where(inArray(partnerOffers.requestId, pprIds));
                }
                // Delete partner price requests
                await tx
                    .delete(partnerPriceRequests)
                    .where(eq(partnerPriceRequests.leadId, id));
            }
            // 2. Unlink quotes linked to this lead
            await tx
                .update(quotes)
                .set({ leadId: null })
                .where(eq(quotes.leadId, id));
            // 3. Delete tasks linked to this lead
            await tx
                .delete(tasks)
                .where(eq(tasks.leadId, id));
            // 4. Finally delete the lead
            await tx.delete(leads).where(eq(leads.id, id));
        });
        return {
            deleted: true,
            leadNumber: existing.leadNumber,
        };
    }
}
export const leadService = new LeadService();
