import { z } from 'zod';
export const documentTypeZodEnum = z.enum([
    'cad_blueprint',
    'werkorder_pdf',
    'offerte_pdf',
    'factuur_pdf',
    'opleverrapport_pdf',
    'bank_statement',
]);
export const createDocumentSchema = z.object({
    fileName: z.string().min(1, 'fileName is required').max(255),
    fileData: z.string().min(1, 'fileData (base64) is required'),
    mimeType: z.string().max(100).optional(),
    documentType: documentTypeZodEnum.default('cad_blueprint'),
    category: z.string().max(50).default('General'),
    description: z.string().optional().nullable(),
    projectId: z.string().uuid().optional().nullable(),
    quoteId: z.string().uuid().optional().nullable(),
    partnerId: z.string().uuid().optional().nullable(),
    leadId: z.string().uuid().optional().nullable(),
    invoiceId: z.string().uuid().optional().nullable(),
    isPublicForCustomer: z.boolean().default(false),
    isPublicForPartner: z.boolean().default(true),
});
export const updateDocumentSchema = z.object({
    category: z.string().max(50).optional(),
    description: z.string().optional().nullable(),
    isPublicForCustomer: z.boolean().optional(),
    isPublicForPartner: z.boolean().optional(),
});
export const documentQuerySchema = z.object({
    category: z.string().optional(),
    projectId: z.string().uuid().optional(),
    partnerId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    quoteId: z.string().uuid().optional(),
    invoiceId: z.string().uuid().optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});
