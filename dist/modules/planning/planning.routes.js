import { z } from 'zod';
import { planningService } from './planning.service.js';
const planningEventIdSchema = z.object({
    id: z.string().uuid('Invalid planning event UUID'),
});
const createPlanningEventSchema = z.object({
    projectId: z.string().uuid().optional().nullable(),
    partnerId: z.string().uuid().optional().nullable(),
    milestoneId: z.string().uuid().optional().nullable(),
    eventType: z.enum(['single_day_delivery', 'multi_day_bouw', 'workshop_production', 'site_survey', 'service_aftercare']),
    calendarLane: z.enum(['delivery_lane', 'bouw_lane', 'workshop_lane']),
    title: z.string().trim().min(2, 'Event title is required'),
    description: z.string().optional(),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    isAllDay: z.boolean().default(false),
    status: z.enum(['scheduled', 'confirmed', 'in_progress', 'completed', 'rescheduled', 'cancelled']).default('scheduled'),
    location: z.string().optional(),
});
const updatePlanningEventSchema = z.object({
    partnerId: z.string().uuid().optional().nullable(),
    eventType: z.enum(['single_day_delivery', 'multi_day_bouw', 'workshop_production', 'site_survey', 'service_aftercare']).optional(),
    calendarLane: z.enum(['delivery_lane', 'bouw_lane', 'workshop_lane']).optional(),
    title: z.string().trim().min(2).optional(),
    description: z.string().optional(),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    isAllDay: z.boolean().optional(),
    status: z.enum(['scheduled', 'confirmed', 'in_progress', 'completed', 'rescheduled', 'cancelled']).optional(),
    location: z.string().optional(),
});
export const planningRoutes = async (fastify) => {
    /**
     * GET /api/planning/events
     */
    fastify.get('/events', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] }, async (request, reply) => {
        const query = request.query;
        const partnerId = request.user.role === 'partner' ? request.user.profileId : query.partnerId;
        const events = await planningService.getEvents({
            calendarLane: query.calendarLane,
            partnerId: partnerId || undefined,
            projectId: query.projectId,
            status: query.status,
        });
        return reply.send({
            success: true,
            data: events,
        });
    });
    /**
     * POST /api/planning/events
     */
    fastify.post('/events', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] }, async (request, reply) => {
        const parsed = createPlanningEventSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message, issues: parsed.error.issues },
            });
        }
        const created = await planningService.createEvent(parsed.data, request.user);
        return reply.status(201).send({
            success: true,
            data: created,
        });
    });
    /**
     * PATCH /api/planning/events/:id
     */
    fastify.patch('/events/:id', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] }, async (request, reply) => {
        const paramCheck = planningEventIdSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid planning event ID' },
            });
        }
        const bodyCheck = updatePlanningEventSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message, issues: bodyCheck.error.issues },
            });
        }
        const updated = await planningService.updateEvent(paramCheck.data.id, bodyCheck.data);
        return reply.send({
            success: true,
            data: updated,
        });
    });
};
