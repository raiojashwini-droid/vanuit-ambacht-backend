import { z } from 'zod';
export const taskPrioritySchema = z.string().transform((val) => {
    const lower = val.toLowerCase();
    if (['low', 'medium', 'high', 'urgent'].includes(lower)) {
        return lower;
    }
    return val;
}).pipe(z.enum(['low', 'medium', 'high', 'urgent']));
export const taskStatusSchema = z.string().transform((val) => {
    const lower = val.toLowerCase();
    if (['pending', 'in_progress', 'completed', 'cancelled'].includes(lower)) {
        return lower;
    }
    return val;
}).pipe(z.enum(['pending', 'in_progress', 'completed', 'cancelled']));
export const createTaskSchema = z.object({
    title: z.string().min(1, 'Title is required').max(255, 'Title cannot exceed 255 characters').transform(s => s.trim()),
    description: z.string().optional(),
    linkedType: z.enum(['Project', 'Lead', 'None']).optional().default('None'),
    projectId: z.string().uuid('Invalid projectId UUID').nullable().optional(),
    leadId: z.string().uuid('Invalid leadId UUID').nullable().optional(),
    assignedToUserId: z.string().uuid('Invalid assignedToUserId UUID').optional(),
    priority: taskPrioritySchema.optional().default('medium'),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be in format YYYY-MM-DD'),
}).refine(data => {
    // If linkedType is None, clear project/lead
    if (data.linkedType === 'None') {
        return true;
    }
    return true;
});
export const updateTaskSchema = z.object({
    title: z.string().min(1, 'Title cannot be empty').max(255).transform(s => s.trim()).optional(),
    description: z.string().nullable().optional(),
    linkedType: z.enum(['Project', 'Lead', 'None']).optional(),
    projectId: z.string().uuid('Invalid projectId UUID').nullable().optional(),
    leadId: z.string().uuid('Invalid leadId UUID').nullable().optional(),
    assignedToUserId: z.string().uuid('Invalid assignedToUserId UUID').optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be in format YYYY-MM-DD').optional(),
});
export const updateTaskStatusSchema = z.object({
    status: taskStatusSchema.optional(),
    completed: z.boolean().optional(),
}).refine(data => data.status !== undefined || data.completed !== undefined, {
    message: 'Either status or completed must be provided',
});
export const reassignTaskSchema = z.object({
    assignedToUserId: z.string().uuid('Invalid assignedToUserId UUID'),
});
export const batchCreateTasksSchema = z.object({
    tasks: z.array(createTaskSchema).min(1, 'At least 1 task must be provided').max(50, 'Max 50 tasks can be imported at once'),
});
export const listTaskStatusQuerySchema = z.string().transform((val) => {
    const lower = val.toLowerCase();
    if (['all', 'pending', 'in_progress', 'completed', 'cancelled'].includes(lower)) {
        return lower;
    }
    return val;
}).pipe(z.enum(['all', 'pending', 'in_progress', 'completed', 'cancelled']));
export const listTasksQuerySchema = z.object({
    status: listTaskStatusQuerySchema.optional(),
    priority: taskPrioritySchema.optional(),
    assigneeId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    search: z.string().optional(),
    dueDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dueDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});
