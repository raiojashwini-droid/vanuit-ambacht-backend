import { z } from 'zod';

export const channelTypeSchema = z.enum(['customer', 'partner', 'internal']);

export const sendMessageSchema = z.object({
  content: z.string().optional(),
  message: z.string().optional(),
  text: z.string().optional(),
  channel: z.string().optional(),
  attachmentDocumentId: z.string().uuid('Invalid document UUID').nullable().optional(),
}).transform(data => ({
  content: (data.content || data.message || data.text || '').trim(),
  attachmentDocumentId: data.attachmentDocumentId,
})).refine(data => data.content.length > 0, {
  message: 'Message content cannot be empty',
  path: ['content'],
});

export const createConversationSchema = z.object({
  projectId: z.string().uuid('Invalid project UUID').optional(),
  leadId: z.string().uuid('Invalid lead UUID').optional(),
  title: z.string().min(1, 'Title is required').max(255).transform(s => s.trim()),
  channelType: channelTypeSchema.default('customer'),
  participantUserIds: z.array(z.string().uuid()).optional(),
}).refine(data => data.projectId !== undefined || data.leadId !== undefined, {
  message: 'Either projectId or leadId must be provided',
});

export const listConversationsQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  channelType: channelTypeSchema.optional(),
  unreadOnly: z.preprocess(val => val === 'true' || val === true, z.boolean()).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  before: z.string().datetime().optional(),
});
