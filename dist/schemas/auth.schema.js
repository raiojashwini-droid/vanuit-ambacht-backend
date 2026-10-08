import { z } from 'zod';
export const loginSchema = z.object({
    email: z.string().email('Valid email is required'),
    password: z.string().min(1, 'Password is required'),
});
export const impersonateHeadersSchema = z.object({
    'x-impersonate-role': z.enum(['partner', 'customer']).optional(),
    'x-impersonate-id': z.string().uuid().optional(),
});
