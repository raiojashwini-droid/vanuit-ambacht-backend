import { z } from 'zod';
export const partnerWorkloadEnumSchema = z.enum(['available', 'busy', 'fully_booked', 'inactive']);
export const partnerQuerySchema = z.object({
    search: z.string().optional(),
    workloadStatus: partnerWorkloadEnumSchema.optional(),
    productType: z.string().optional(),
    region: z.string().optional(),
    isActive: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: z.enum(['createdAt', 'companyName', 'rating', 'workloadStatus']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export const createPartnerSchema = z.object({
    partnerCode: z.string().trim().min(3).max(50).optional(),
    companyName: z.string().trim().min(1, 'Company name is required').max(150),
    contactPerson: z.string().trim().min(1, 'Contact person is required').max(150),
    email: z.string().trim().email('Valid email is required').max(255),
    phone: z.string().trim().min(3, 'Phone is required').max(50),
    kvkNumber: z.string().trim().max(50).nullable().optional(),
    btwNumber: z.string().trim().max(50).nullable().optional(),
    region: z.string().trim().max(100).nullable().optional(),
    workloadStatus: partnerWorkloadEnumSchema.default('available'),
    availableWeeks: z.array(z.coerce.number().int().min(1).max(53)).nullable().optional(),
    rating: z.coerce.number().min(1.0).max(5.0).default(5.0),
    specialties: z.array(z.string()).nullable().optional(),
    productTypes: z.array(z.string()).nullable().optional(),
    isActive: z.boolean().default(true),
    userId: z.string().uuid().nullable().optional(),
    password: z.string().min(4).optional(),
});
export const updatePartnerSchema = createPartnerSchema.partial();
export const updateWorkloadSchema = z.object({
    workloadStatus: partnerWorkloadEnumSchema.optional(),
    availableWeeks: z.array(z.coerce.number().int().min(1).max(53)).nullable().optional(),
}).refine(data => data.workloadStatus !== undefined || data.availableWeeks !== undefined, {
    message: 'At least one of workloadStatus or availableWeeks must be provided',
});
export const ratePartnerSchema = z.object({
    rating: z.coerce.number().min(1.0, 'Minimum rating is 1.00').max(5.0, 'Maximum rating is 5.00'),
});
export const partnerIdParamSchema = z.object({
    id: z.string().uuid('Valid partner UUID required'),
});
