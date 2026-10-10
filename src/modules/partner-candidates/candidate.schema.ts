import { z } from 'zod';

export const candidateStageEnumSchema = z.enum([
  'interested',
  'in_discussion',
  'trial_project',
  'active',
  'rejected',
]);

export const candidateQuerySchema = z.object({
  search: z.string().optional(),
  stage: candidateStageEnumSchema.optional(),
  region: z.string().optional(),
});

export const createCandidateSchema = z.object({
  name: z.string().trim().min(1, 'Candidate name is required').max(150),
  companyName: z.string().trim().max(150).optional(),
  email: z.string().trim().email('Valid email is required').max(255),
  phone: z.string().trim().min(3, 'Phone is required').max(50),
  region: z.string().trim().max(100).default('Nederland'),
  stage: candidateStageEnumSchema.default('interested'),
  notes: z.string().trim().optional(),
  specialties: z.array(z.string()).optional(),
  productTypes: z.array(z.string()).optional(),
  kvkNumber: z.string().trim().max(50).optional(),
  btwNumber: z.string().trim().max(50).optional(),
});

export const updateCandidateSchema = createCandidateSchema.partial();

export const updateCandidateStageSchema = z.object({
  stage: candidateStageEnumSchema,
  notes: z.string().trim().optional(),
});

export const convertCandidateSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters'),
  companyName: z.string().trim().max(150).optional(),
  kvkNumber: z.string().trim().max(50).optional(),
  btwNumber: z.string().trim().max(50).optional(),
  productTypes: z.array(z.string()).optional(),
  workloadStatus: z.enum(['available', 'busy', 'fully_booked', 'inactive']).default('available'),
});

export const candidateIdParamSchema = z.object({
  id: z.string().uuid('Valid candidate UUID required'),
});

export type CreateCandidateInput = z.infer<typeof createCandidateSchema>;
export type UpdateCandidateInput = z.infer<typeof updateCandidateSchema>;
export type UpdateCandidateStageInput = z.infer<typeof updateCandidateStageSchema>;
export type ConvertCandidateInput = z.infer<typeof convertCandidateSchema>;
export type CandidateQueryParams = z.infer<typeof candidateQuerySchema>;
