import { partnerQuerySchema, createPartnerSchema, updatePartnerSchema, updateWorkloadSchema, ratePartnerSchema, partnerIdParamSchema, } from './partner.schema.js';
import { partnerService, PartnerError } from './partner.service.js';
export const partnerRoutes = async (fastify) => {
    /**
     * GET /api/partners
     * List craftsmen with search, workload filter, specialty/product types, and pagination
     */
    fastify.get('/', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] }, async (request, reply) => {
        const parseResult = partnerQuerySchema.safeParse(request.query);
        if (!parseResult.success) {
            return reply.status(400).send({
                success: false,
                error: {
                    code: 'VALIDATION_FAILED',
                    message: 'Invalid query parameters',
                    details: parseResult.error.format(),
                },
            });
        }
        try {
            const result = await partnerService.list(parseResult.data);
            return reply.status(200).send({
                success: true,
                data: result,
            });
        }
        catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve partners' },
            });
        }
    });
    /**
     * GET /api/partners/:id
     * Partner dossier with assigned projects, submitted bids, and performance metrics
     */
    fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const paramResult = partnerIdParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid partner UUID parameter' },
            });
        }
        try {
            const dossier = await partnerService.getDossier(paramResult.data.id);
            // Scoping: Partners can only view their own detailed commercial dossier
            const effectiveRole = request.effectiveRole || request.user.role;
            if (effectiveRole === 'partner') {
                const isOwner = dossier.userId === request.user.sub ||
                    dossier.id === request.user.profileId ||
                    dossier.id === request.effectiveProfileId;
                if (!isOwner) {
                    return reply.status(403).send({
                        success: false,
                        error: { code: 'FORBIDDEN', message: 'Access denied. You may only view your own partner dossier.' },
                    });
                }
            }
            return reply.status(200).send({
                success: true,
                data: dossier,
            });
        }
        catch (err) {
            if (err instanceof PartnerError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve partner dossier' },
            });
        }
    });
    /**
     * POST /api/partners
     * Create new craftsman partner (Admin only)
     */
    fastify.post('/', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const parseResult = createPartnerSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                success: false,
                error: {
                    code: 'VALIDATION_FAILED',
                    message: 'Invalid partner payload',
                    details: parseResult.error.format(),
                },
            });
        }
        try {
            const created = await partnerService.create(parseResult.data);
            return reply.status(201).send({
                success: true,
                message: 'Partner created successfully',
                data: created,
            });
        }
        catch (err) {
            if (err instanceof PartnerError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to create partner' },
            });
        }
    });
    /**
     * PATCH /api/partners/:id
     * Update partner details
     */
    fastify.patch('/:id', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] }, async (request, reply) => {
        const paramResult = partnerIdParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid partner UUID parameter' },
            });
        }
        const parseResult = updatePartnerSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                success: false,
                error: {
                    code: 'VALIDATION_FAILED',
                    message: 'Invalid update payload',
                    details: parseResult.error.format(),
                },
            });
        }
        const effectiveRole = request.effectiveRole || request.user.role;
        // Partners cannot modify their own rating or partner code
        if (effectiveRole === 'partner') {
            delete parseResult.data.rating;
            delete parseResult.data.partnerCode;
        }
        try {
            const updated = await partnerService.update(paramResult.data.id, parseResult.data);
            return reply.status(200).send({
                success: true,
                message: 'Partner updated successfully',
                data: updated,
            });
        }
        catch (err) {
            if (err instanceof PartnerError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to update partner' },
            });
        }
    });
    /**
     * PATCH /api/partners/:id/workload
     * Dedicated endpoint: Update craftsman workload status ('available', 'busy', 'fully_booked', 'inactive')
     */
    fastify.patch('/:id/workload', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] }, async (request, reply) => {
        const paramResult = partnerIdParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid partner UUID parameter' },
            });
        }
        const parseResult = updateWorkloadSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                success: false,
                error: {
                    code: 'VALIDATION_FAILED',
                    message: 'Invalid workload status. Allowed: available, busy, fully_booked, inactive',
                    details: parseResult.error.format(),
                },
            });
        }
        try {
            const updated = await partnerService.updateWorkload(paramResult.data.id, parseResult.data.workloadStatus);
            return reply.status(200).send({
                success: true,
                message: `Workload status updated to '${parseResult.data.workloadStatus}'`,
                data: updated,
            });
        }
        catch (err) {
            if (err instanceof PartnerError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to update partner workload' },
            });
        }
    });
    /**
     * POST /api/partners/:id/rate
     * Dedicated endpoint: Rate craftsman (1.00 to 5.00) (Admin only)
     */
    fastify.post('/:id/rate', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramResult = partnerIdParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid partner UUID parameter' },
            });
        }
        const parseResult = ratePartnerSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                success: false,
                error: {
                    code: 'VALIDATION_FAILED',
                    message: 'Invalid rating. Value must be between 1.00 and 5.00',
                    details: parseResult.error.format(),
                },
            });
        }
        try {
            const updated = await partnerService.rate(paramResult.data.id, parseResult.data.rating);
            return reply.status(200).send({
                success: true,
                message: `Partner rating updated to ${parseResult.data.rating.toFixed(2)}`,
                data: updated,
            });
        }
        catch (err) {
            if (err instanceof PartnerError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to update partner rating' },
            });
        }
    });
    /**
     * DELETE /api/partners/:id
     * Delete partner with active dependency checks (Admin only)
     */
    fastify.delete('/:id', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramResult = partnerIdParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid partner UUID parameter' },
            });
        }
        try {
            const result = await partnerService.delete(paramResult.data.id);
            return reply.status(200).send({
                success: true,
                message: `Partner ${result.partnerCode} deleted successfully`,
                data: result,
            });
        }
        catch (err) {
            if (err instanceof PartnerError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to delete partner' },
            });
        }
    });
};
