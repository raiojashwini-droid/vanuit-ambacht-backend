import { z } from 'zod';

export const productTypeEnumValues = ['outdoor_kitchen', 'garden_room', 'canopy', 'bin_storage'] as const;
export const leadStatusEnumValues = ['new', 'in_conversation', 'price_requested', 'price_received', 'quote_sent', 'won', 'lost'] as const;

export const leadQuerySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  workflowStep: z.coerce.number().int().min(1).max(8).optional(),
  productType: z.enum(productTypeEnumValues).optional(),
  assignedToUserId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['createdAt', 'name', 'workflowStep', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const createLeadSchema = z.object({
  name: z.string().trim().min(1, 'Lead name is required').max(150),
  email: z.string().trim().email('Valid email required').max(255).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  address: z.string().trim().max(255).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  productType: z.enum(productTypeEnumValues).default('outdoor_kitchen'),
  dimensionsInquiry: z.string().trim().max(100).nullable().optional(),
  source: z.string().trim().max(100).default('Direct'),
  status: z.enum(leadStatusEnumValues).default('new'),
  workflowStep: z.coerce.number().int().min(1).max(8).default(1),
  assignedToUserId: z.string().uuid().optional(),
  notes: z.string().nullable().optional(),
});

export const updateLeadSchema = createLeadSchema.partial();

export const updateStepSchema = z.object({
  workflowStep: z.coerce.number().int().min(1, 'Minimum workflow step is 1').max(8, 'Maximum workflow step is 8'),
});

export const updateStatusSchema = z.object({
  status: z.enum(leadStatusEnumValues),
  lostReason: z.string().nullable().optional(),
});

export const addVoiceNoteSchema = z.object({
  fileName: z.string().trim().min(1, 'File name is required').max(255),
  fileUrl: z.string().trim().min(1, 'File URL or storage identifier is required'),
  durationSeconds: z.coerce.number().int().min(0).nullable().optional(),
  recordingDate: z.string().datetime().optional(),
  transcriptText: z.string().nullable().optional(),
  aiSummary: z.string().nullable().optional(),
  extractedSpecs: z.record(z.any()).nullable().optional(),
});

export const updateVoiceNoteSchema = z.object({
  transcriptText: z.string().nullable().optional(),
  aiSummary: z.string().nullable().optional(),
  extractedSpecs: z.record(z.any()).nullable().optional(),
});

export const addCommercialActionSchema = z.object({
  note: z.string().trim().min(1, 'Note content is required'),
  actionType: z.string().trim().max(50).default('consultation_note'),
  actionDate: z.string().datetime().optional(),
  createTask: z.boolean().default(false),
  taskTitle: z.string().trim().max(255).optional(),
  taskDueDate: z.string().optional(),
  taskPriority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  taskAssigneeUserId: z.string().uuid().optional(),
});

export const leadIdParamSchema = z.object({
  id: z.string().uuid('Valid lead UUID required'),
});

export const voiceNoteParamSchema = z.object({
  id: z.string().uuid('Valid lead UUID required'),
  vnId: z.string().uuid('Valid voice note UUID required'),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type AddVoiceNoteInput = z.infer<typeof addVoiceNoteSchema>;
export type UpdateVoiceNoteInput = z.infer<typeof updateVoiceNoteSchema>;
export type AddCommercialActionInput = z.infer<typeof addCommercialActionSchema>;
export type LeadQueryParamsInput = z.infer<typeof leadQuerySchema>;
