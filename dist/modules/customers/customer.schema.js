import { z } from 'zod';
export const customerQuerySchema = z.object({
    search: z.string().optional(),
    city: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: z.enum(['createdAt', 'lastName', 'city', 'customerNumber']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export const createCustomerSchema = z.object({
    customerNumber: z.string().trim().min(3).max(50).optional(),
    companyName: z.string().trim().max(150).nullable().optional(),
    firstName: z.string().trim().min(1, 'First name is required').max(100),
    lastName: z.string().trim().min(1, 'Last name is required').max(100),
    email: z.string().trim().email('Valid email is required').max(255),
    phone: z.string().trim().min(3, 'Phone is required').max(50),
    streetAddress: z.string().trim().max(255).nullable().optional(),
    postalCode: z.string().trim().max(20).nullable().optional(),
    city: z.string().trim().min(1, 'City is required').max(100),
    country: z.string().trim().max(50).default('NL'),
    notes: z.string().nullable().optional(),
    userId: z.string().uuid().nullable().optional(),
});
export const updateCustomerSchema = createCustomerSchema.partial();
export const customerIdParamSchema = z.object({
    id: z.string().uuid('Valid customer UUID required'),
});
