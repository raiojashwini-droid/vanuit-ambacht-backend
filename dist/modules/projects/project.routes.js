import { z } from 'zod';
import { projectService, ProjectError } from './project.service.js';
import { projectMilestoneService, MilestoneError } from './project-milestone.service.js';
import { projectPhotoService, PhotoError } from './project-photo.service.js';
import { projectListQuerySchema, createProjectSchema, updateProjectSchema, updateProjectStatusSchema, updateStatusTextsSchema, createCustomerActionSchema, updateCustomerActionSchema, proposeDeliverySlotSchema, updateSchouwSchema, updateWeekPlanningSchema, createRenderVersionSchema, completeOpleveringSchema, assignPartnerSchema, createMilestoneSchema, updateMilestoneSchema, createPhotoSchema, updatePhotoSchema, createProjectDocumentSchema, } from './project.schema.js';
const projectIdParamSchema = z.object({
    id: z.string().uuid('Invalid project UUID'),
});
const milestoneIdParamSchema = z.object({
    id: z.string().uuid('Invalid project UUID'),
    mId: z.string().uuid('Invalid milestone UUID'),
});
const photoIdParamSchema = z.object({
    id: z.string().uuid('Invalid project UUID'),
    photoId: z.string().uuid('Invalid photo UUID'),
});
const actionIdParamSchema = z.object({
    id: z.string().uuid('Invalid project UUID'),
    actionId: z.string().min(1, 'Action ID is required'),
});
const renderVersionIdParamSchema = z.object({
    id: z.string().uuid('Invalid project UUID'),
    versionId: z.string().min(1, 'Version ID is required'),
});
export const projectRoutes = async (fastify) => {
    /**
     * GET /api/projects
     * List projects with search, filtering, pagination (Admin & Partner)
     */
    fastify.get('/', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner', 'customer'])] }, async (request, reply) => {
        const queryResult = projectListQuerySchema.safeParse(request.query);
        if (!queryResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_QUERY', message: queryResult.error.issues[0]?.message },
            });
        }
        const result = await projectService.listProjects(queryResult.data, request.user);
        return reply.send({
            success: true,
            data: result.data,
            pagination: {
                total: result.total,
                page: result.page,
                limit: result.limit,
                totalPages: result.totalPages,
            },
        });
    });
    /**
     * GET /api/projects/:id
     * Get single project detail
     */
    fastify.get('/:id', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner', 'customer'])] }, async (request, reply) => {
        const paramCheck = projectIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID format' },
            });
        }
        try {
            const project = await projectService.getById(paramCheck.data.id, request.user);
            return reply.send({ success: true, data: project });
        }
        catch (err) {
            if (err instanceof ProjectError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * POST /api/projects
     * Direct creation of projects (Admin only)
     */
    fastify.post('/', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const bodyCheck = createProjectSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message, issues: bodyCheck.error.issues },
            });
        }
        try {
            const created = await projectService.createProject(bodyCheck.data, request.user);
            return reply.status(201).send({ success: true, data: created });
        }
        catch (err) {
            if (err instanceof ProjectError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * PUT /api/projects/:id
     * Update project metadata (Admin only)
     */
    fastify.put('/:id', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = projectIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
            });
        }
        const bodyCheck = updateProjectSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
            });
        }
        try {
            const updated = await projectService.updateProject(paramCheck.data.id, bodyCheck.data, request.user);
            return reply.send({ success: true, data: updated });
        }
        catch (err) {
            if (err instanceof ProjectError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * DELETE /api/projects/:id
     * Safe deletion / soft-cancel (Admin only)
     */
    fastify.delete('/:id', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = projectIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
            });
        }
        try {
            const result = await projectService.softDeleteProject(paramCheck.data.id, request.user);
            return reply.send({ success: true, message: result.message });
        }
        catch (err) {
            if (err instanceof ProjectError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * PATCH /api/projects/:id/status
     * Advance production step or status (Admin only)
     */
    fastify.patch('/:id/status', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = projectIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
            });
        }
        const bodyCheck = updateProjectStatusSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
            });
        }
        try {
            const updated = await projectService.updateStatus(paramCheck.data.id, bodyCheck.data, request.user);
            return reply.send({ success: true, data: updated });
        }
        catch (err) {
            if (err instanceof ProjectError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * PATCH /api/projects/:id/status-texts
     * Edit "Status & Teksten" (Admin only)
     */
    fastify.patch('/:id/status-texts', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = projectIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
            });
        }
        const bodyCheck = updateStatusTextsSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
            });
        }
        const updated = await projectService.updateStatusTexts(paramCheck.data.id, bodyCheck.data, request.user);
        return reply.send({ success: true, data: updated });
    });
    /**
     * POST /api/projects/:id/customer-actions
     */
    fastify.post('/:id/customer-actions', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = projectIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
            });
        }
        const bodyCheck = createCustomerActionSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
            });
        }
        const updated = await projectService.addCustomerAction(paramCheck.data.id, bodyCheck.data, request.user);
        return reply.status(201).send({ success: true, data: updated });
    });
    /**
     * PATCH /api/projects/:id/customer-actions/:actionId
     */
    fastify.patch('/:id/customer-actions/:actionId', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = actionIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_PARAMS', message: 'Invalid project or action ID' },
            });
        }
        const bodyCheck = updateCustomerActionSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
            });
        }
        try {
            const updated = await projectService.updateCustomerAction(paramCheck.data.id, paramCheck.data.actionId, bodyCheck.data, request.user);
            return reply.send({ success: true, data: updated });
        }
        catch (err) {
            if (err instanceof ProjectError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * DELETE /api/projects/:id/customer-actions/:actionId
     */
    fastify.delete('/:id/customer-actions/:actionId', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = actionIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_PARAMS', message: 'Invalid project or action ID' },
            });
        }
        try {
            const updated = await projectService.deleteCustomerAction(paramCheck.data.id, paramCheck.data.actionId, request.user);
            return reply.send({ success: true, data: updated });
        }
        catch (err) {
            if (err instanceof ProjectError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * PUT /api/projects/:id/delivery-slot
     * Admin proposes delivery slot (Approved Decision #2)
     */
    fastify.put('/:id/delivery-slot', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = projectIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
            });
        }
        const bodyCheck = proposeDeliverySlotSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
            });
        }
        const updated = await projectService.proposeDeliverySlot(paramCheck.data.id, bodyCheck.data, request.user);
        return reply.send({ success: true, data: updated });
    });
    /**
     * PATCH /api/projects/:id/assign-partner
     */
    fastify.patch('/:id/assign-partner', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = projectIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
            });
        }
        const bodyCheck = assignPartnerSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
            });
        }
        try {
            const updated = await projectService.assignPartner(paramCheck.data.id, bodyCheck.data.partnerId, bodyCheck.data.agreedBuildPrice, request.user);
            return reply.send({ success: true, data: updated });
        }
        catch (err) {
            if (err instanceof ProjectError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * GET /api/projects/:id/werkorder-pdf
     * Download Werkorder PDF (Admin and Partner)
     */
    fastify.get('/:id/werkorder-pdf', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] }, async (request, reply) => {
        const paramCheck = projectIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
            });
        }
        try {
            const { buffer, fileName } = await projectService.generateWerkorderPdf(paramCheck.data.id, request.user);
            reply.header('Content-Type', 'application/pdf');
            reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
            reply.header('Content-Length', buffer.length);
            return reply.send(buffer);
        }
        catch (err) {
            if (err instanceof ProjectError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    // ==========================================
    // GARDEN ROOM SPECIFIC ENDPOINTS
    // ==========================================
    /**
     * PUT /api/projects/:id/schouw
     */
    fastify.put('/:id/schouw', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = projectIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
            });
        }
        const bodyCheck = updateSchouwSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
            });
        }
        const updated = await projectService.updateSchouw(paramCheck.data.id, bodyCheck.data, request.user);
        return reply.send({ success: true, data: updated });
    });
    /**
     * PUT /api/projects/:id/week-planning
     */
    fastify.put('/:id/week-planning', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = projectIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
            });
        }
        const bodyCheck = updateWeekPlanningSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
            });
        }
        const updated = await projectService.updateWeekPlanning(paramCheck.data.id, bodyCheck.data.weeks, request.user);
        return reply.send({ success: true, data: updated });
    });
    /**
     * POST /api/projects/:id/render-versions
     */
    fastify.post('/:id/render-versions', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = projectIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
            });
        }
        const bodyCheck = createRenderVersionSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
            });
        }
        const updated = await projectService.addRenderVersion(paramCheck.data.id, bodyCheck.data, request.user);
        return reply.status(201).send({ success: true, data: updated });
    });
    /**
     * PATCH /api/projects/:id/render-versions/:versionId/set-live
     */
    fastify.patch('/:id/render-versions/:versionId/set-live', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = renderVersionIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_PARAMS', message: 'Invalid project or version ID' },
            });
        }
        try {
            const updated = await projectService.setRenderVersionLive(paramCheck.data.id, paramCheck.data.versionId, request.user);
            return reply.send({ success: true, data: updated });
        }
        catch (err) {
            if (err instanceof ProjectError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * POST /api/projects/:id/oplevering
     * Complete Handover checklist, signature, generate Opleverrapport PDF (Approved Decision #3: Transactional)
     */
    fastify.post('/:id/oplevering', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] }, async (request, reply) => {
        const paramCheck = projectIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
            });
        }
        const bodyCheck = completeOpleveringSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
            });
        }
        try {
            const result = await projectService.completeOplevering(paramCheck.data.id, bodyCheck.data, request.user);
            return reply.send({
                success: true,
                data: result,
                message: 'Oplevering succesvol voltooid en Opleverrapport PDF opgeslagen.',
            });
        }
        catch (err) {
            if (err instanceof ProjectError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    // ==========================================
    // MILESTONE SUB-RESOURCE ROUTES
    // ==========================================
    /**
     * GET /api/projects/:id/milestones
     */
    fastify.get('/:id/milestones', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner', 'customer'])] }, async (request, reply) => {
        const paramCheck = projectIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
            });
        }
        const list = await projectMilestoneService.getMilestones(paramCheck.data.id, request.user);
        return reply.send({ success: true, data: list });
    });
    /**
     * POST /api/projects/:id/milestones
     */
    fastify.post('/:id/milestones', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = projectIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
            });
        }
        const bodyCheck = createMilestoneSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
            });
        }
        try {
            const created = await projectMilestoneService.createMilestone(paramCheck.data.id, bodyCheck.data, request.user);
            return reply.status(201).send({ success: true, data: created });
        }
        catch (err) {
            if (err instanceof MilestoneError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * PATCH /api/projects/:id/milestones/:mId
     */
    fastify.patch('/:id/milestones/:mId', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = milestoneIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_PARAMS', message: 'Invalid project or milestone UUID' },
            });
        }
        const bodyCheck = updateMilestoneSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
            });
        }
        try {
            const updated = await projectMilestoneService.updateMilestone(paramCheck.data.id, paramCheck.data.mId, bodyCheck.data, request.user);
            return reply.send({ success: true, data: updated });
        }
        catch (err) {
            if (err instanceof MilestoneError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * DELETE /api/projects/:id/milestones/:mId
     * Invoice-linked protection
     */
    fastify.delete('/:id/milestones/:mId', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = milestoneIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_PARAMS', message: 'Invalid project or milestone UUID' },
            });
        }
        try {
            const result = await projectMilestoneService.deleteMilestone(paramCheck.data.id, paramCheck.data.mId, request.user);
            return reply.send(result);
        }
        catch (err) {
            if (err instanceof MilestoneError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    // ==========================================
    // PHOTO SUB-RESOURCE ROUTES
    // ==========================================
    /**
     * GET /api/projects/:id/photos
     * Enforces customer scoping: customers only see visible_to_customer
     */
    fastify.get('/:id/photos', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner', 'customer'])] }, async (request, reply) => {
        const paramCheck = projectIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
            });
        }
        const list = await projectPhotoService.getPhotos(paramCheck.data.id, request.user);
        return reply.send({ success: true, data: list });
    });
    /**
     * POST /api/projects/:id/photos
     */
    fastify.post('/:id/photos', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] }, async (request, reply) => {
        const paramCheck = projectIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
            });
        }
        const bodyCheck = createPhotoSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
            });
        }
        try {
            const created = await projectPhotoService.uploadPhoto(paramCheck.data.id, bodyCheck.data, request.user);
            return reply.status(201).send({ success: true, data: created });
        }
        catch (err) {
            if (err instanceof PhotoError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * PATCH /api/projects/:id/photos/:photoId
     */
    fastify.patch('/:id/photos/:photoId', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = photoIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_PARAMS', message: 'Invalid project or photo UUID' },
            });
        }
        const bodyCheck = updatePhotoSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
            });
        }
        try {
            const updated = await projectPhotoService.updatePhoto(paramCheck.data.id, paramCheck.data.photoId, bodyCheck.data, request.user);
            return reply.send({ success: true, data: updated });
        }
        catch (err) {
            if (err instanceof PhotoError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * DELETE /api/projects/:id/photos/:photoId
     * Removes DB record AND disk file
     */
    fastify.delete('/:id/photos/:photoId', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = photoIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_PARAMS', message: 'Invalid project or photo UUID' },
            });
        }
        try {
            const result = await projectPhotoService.deletePhoto(paramCheck.data.id, paramCheck.data.photoId, request.user);
            return reply.send(result);
        }
        catch (err) {
            if (err instanceof PhotoError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    // ==========================================
    // DOCUMENT SUB-RESOURCE ROUTES
    // ==========================================
    /**
     * POST /api/projects/:id/documents
     */
    fastify.post('/:id/documents', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramCheck = projectIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
            });
        }
        const bodyCheck = createProjectDocumentSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
            });
        }
        try {
            const created = await projectService.createDocument(paramCheck.data.id, bodyCheck.data, request.user);
            return reply.status(201).send({ success: true, data: created });
        }
        catch (err) {
            if (err instanceof ProjectError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
};
