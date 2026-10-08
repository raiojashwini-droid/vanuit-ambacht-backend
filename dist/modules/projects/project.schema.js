import { z } from 'zod';
export const projectTypeEnumSchema = z.enum(['outdoor_kitchen', 'garden_room']);
export const projectStatusEnumSchema = z.enum(['pending', 'in_progress', 'completed', 'on_hold', 'cancelled']);
export const milestoneStatusEnumSchema = z.enum(['pending', 'in_progress', 'completed']);
export const projectListQuerySchema = z.object({
    type: projectTypeEnumSchema.optional(),
    status: projectStatusEnumSchema.optional(),
    partnerId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    search: z.string().trim().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    sort: z.string().default('createdAt:desc'),
});
export const createProjectSchema = z.object({
    name: z.string().trim().min(2, 'Project name is required'),
    projectType: projectTypeEnumSchema,
    customerId: z.string().uuid('Valid customer ID is required'),
    partnerId: z.string().uuid().optional().nullable(),
    quoteId: z.string().uuid().optional().nullable(),
    quoteVersionId: z.string().uuid().optional().nullable(),
    contractValue: z.number().nonnegative().optional().nullable(),
    agreedBuildPrice: z.number().nonnegative().optional().nullable(),
    deliveryAddress: z.string().trim().min(3, 'Delivery address is required'),
    postalCode: z.string().trim().optional().nullable(),
    city: z.string().trim().min(2, 'City is required'),
    orderStatus: z.string().optional().default('in_voorbereiding'),
    productionStep: z.number().int().min(1).max(7).default(1),
    technicalSpecs: z.record(z.any()).optional(),
});
export const updateProjectSchema = z.object({
    name: z.string().trim().min(2).optional(),
    customerId: z.string().uuid().optional(),
    partnerId: z.string().uuid().optional().nullable(),
    deliveryAddress: z.string().trim().min(3).optional(),
    postalCode: z.string().trim().optional().nullable(),
    city: z.string().trim().min(2).optional(),
    contractValue: z.number().nonnegative().optional().nullable(),
    agreedBuildPrice: z.number().nonnegative().optional().nullable(),
    progressPercentage: z.number().int().min(0).max(100).optional(),
    orderStatus: z.string().optional(),
    technicalSpecs: z.record(z.any()).optional(),
});
export const updateProjectStatusSchema = z.object({
    status: projectStatusEnumSchema.optional(),
    productionStep: z.number().int().min(1).max(7).optional(),
    orderStatus: z.string().optional(),
    progressPercentage: z.number().int().min(0).max(100).optional(),
    reason: z.string().optional(),
});
export const updateStatusTextsSchema = z.object({
    watErNuGebeurt: z.string().optional(),
    watErHiernaKomt: z.string().optional(),
    leverweek: z.string().optional(),
    leverStatus: z.string().optional(),
    internalNotes: z.string().optional(),
});
export const createCustomerActionSchema = z.object({
    title: z.string().trim().min(2, 'Action title is required'),
    subtitle: z.string().trim().optional(),
    actionType: z.enum(['proposal', 'checklist', 'confirmation', 'document']).default('checklist'),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD').optional(),
});
export const updateCustomerActionSchema = z.object({
    title: z.string().trim().min(2).optional(),
    subtitle: z.string().trim().optional(),
    actionType: z.enum(['proposal', 'checklist', 'confirmation', 'document']).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    completed: z.boolean().optional(),
});
export const proposeDeliverySlotSchema = z.object({
    proposedDate: z.string().min(5, 'Delivery date is required'),
    timeWindow: z.string().optional().default('08:00 - 12:00'),
    notes: z.string().optional(),
});
export const confirmDeliverySlotSchema = z.object({
    confirmed: z.boolean().default(true),
    notes: z.string().optional(),
});
export const updateSchouwSchema = z.object({
    schouwDate: z.string().optional(),
    inspectorName: z.string().optional(),
    accessDetails: z.string().optional(),
    foundationCheck: z.boolean().optional(),
    notes: z.string().optional(),
    completed: z.boolean().optional(),
});
export const updateWeekPlanningSchema = z.object({
    weeks: z.array(z.object({
        id: z.string().optional(),
        weekNumber: z.number().int().min(1).max(53),
        phase: z.string().min(1, 'Phase description is required'),
        status: z.enum(['pending', 'in_progress', 'completed']).default('pending'),
        notes: z.string().optional(),
    })),
});
export const createRenderVersionSchema = z.object({
    title: z.string().trim().min(2, 'Version title is required'),
    versionNumber: z.number().int().min(1).optional(),
    woodColor: z.string().optional(),
    notes: z.string().optional(),
    images: z.array(z.string()).default([]),
    isLive: z.boolean().default(false),
});
export const renderFeedbackSchema = z.object({
    renderVersionId: z.string().min(1, 'Render version ID is required'),
    comment: z.string().trim().min(2, 'Comment cannot be empty'),
});
export const customerChecklistSchema = z.object({
    completed: z.boolean(),
});
export const completeOpleveringSchema = z.object({
    checklist: z.record(z.boolean()),
    signeeName: z.string().trim().min(2, 'Signee name is required'),
    signatureDataUrl: z.string().min(10, 'Signature is required'),
    notes: z.string().optional(),
});
export const assignPartnerSchema = z.object({
    partnerId: z.string().uuid('Valid partner ID is required'),
    agreedBuildPrice: z.number().nonnegative('Agreed build price must be non-negative'),
});
export const createMilestoneSchema = z.object({
    title: z.string().trim().min(2, 'Title is required'),
    milestoneCode: z.string().trim().optional(),
    description: z.string().optional(),
    sequenceOrder: z.number().int().min(1).default(1),
    status: milestoneStatusEnumSchema.default('pending'),
    scheduledStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    scheduledEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});
export const updateMilestoneSchema = z.object({
    title: z.string().trim().min(2).optional(),
    description: z.string().optional().nullable(),
    sequenceOrder: z.number().int().min(1).optional(),
    status: milestoneStatusEnumSchema.optional(),
    scheduledStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    scheduledEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    completedAt: z.string().datetime().optional().nullable(),
});
export const createPhotoSchema = z.object({
    photoUrl: z.string().trim().min(1, 'Photo URL or base64 is required'),
    title: z.string().optional().nullable(),
    phase: z.string().optional().nullable(),
    craftsman: z.string().optional().nullable(),
    caption: z.string().optional().nullable(),
    tag: z.string().optional().default('general'),
    visibleToCustomer: z.boolean().default(true),
});
export const updatePhotoSchema = z.object({
    title: z.string().optional().nullable(),
    phase: z.string().optional().nullable(),
    craftsman: z.string().optional().nullable(),
    photoUrl: z.string().optional().nullable(),
    caption: z.string().optional().nullable(),
    tag: z.string().optional().nullable(),
    visibleToCustomer: z.boolean().optional(),
});
export const createProjectDocumentSchema = z.object({
    fileName: z.string().trim().min(1, 'File name is required'),
    fileUrl: z.string().trim().min(1, 'File URL or path is required'),
    documentType: z.enum(['cad_blueprint', 'werkorder_pdf', 'opleverrapport_pdf']).default('cad_blueprint'),
    fileSizeBytes: z.number().int().positive().optional().nullable(),
    mimeType: z.string().optional().default('application/pdf'),
    isPublicForCustomer: z.boolean().default(false),
    isPublicForPartner: z.boolean().default(true),
});
