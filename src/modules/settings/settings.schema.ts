import { z } from 'zod';

export const updateCompanySettingsSchema = z.object({
  companyName: z.string().min(1, 'Company name is required').max(150).optional(),
  website: z.string().max(255).nullable().optional(),
  kvkNumber: z.string().max(50).nullable().optional(),
  btwNumber: z.string().max(50).nullable().optional(),
  iban: z.string().max(50).nullable().optional(),
  bankName: z.string().max(100).nullable().optional(),
  email: z.string().email('Invalid email address').max(255).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  address: z.string().max(255).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().max(50).optional(),
  standardVatRate: z.coerce.number().min(0).max(100).optional(),
  lowVatRate: z.coerce.number().min(0).max(100).optional(),
  quotePrefix: z.string().min(1).max(50).optional(),
  invoicePrefix: z.string().min(1).max(50).optional(),
  defaultMarginPercentage: z.coerce.number().min(0).max(100).optional(),
  quoteTermsText: z.string().nullable().optional(),
  fiscalLockDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fiscalLockDate must be YYYY-MM-DD').nullable().optional(),
  brandingColors: z.any().optional(),
  categoriesConfig: z.any().optional(),
  fieldsetsConfig: z.any().optional(),
  partnerBreakdownConfig: z.any().optional(),
  plConfig: z.any().optional(),
  messageTemplates: z.any().optional(),
  quoteTemplateConfig: z.any().optional(),
  integrationsConfig: z.any().optional(),
});

export const configSectionParamSchema = z.object({
  section: z.enum([
    'branding',
    'categories',
    'fieldsets',
    'partner-breakdown',
    'pl-targets',
    'templates',
    'quote-template',
    'integrations',
  ]),
});

export const createSystemUserSchema = z.object({
  fullName: z.string().min(2, 'Name must be at least 2 characters').max(150),
  email: z.string().email('Invalid email address').max(255),
  role: z.enum(['admin', 'partner', 'customer']),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  phone: z.string().max(50).nullable().optional(),
});

export const updateUserStatusSchema = z.object({
  isActive: z.boolean({ required_error: 'isActive is required' }),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(['admin', 'partner', 'customer'], { required_error: 'Role is required' }),
});

export type UpdateCompanySettingsInput = z.infer<typeof updateCompanySettingsSchema>;
export type CreateSystemUserInput = z.infer<typeof createSystemUserSchema>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
