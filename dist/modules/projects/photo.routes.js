import { z } from 'zod';
import { projectPhotoService, PhotoError } from './project-photo.service.js';
import { updatePhotoSchema } from './project.schema.js';
import { storageService } from '../../services/storage.service.js';
const photoIdParamSchema = z.object({
    photoId: z.string().uuid('Invalid photo UUID'),
});
const globalPhotosQuerySchema = z.object({
    projectId: z.string().optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});
const toggleVisibilitySchema = z.object({
    visibleToCustomer: z.boolean().optional(),
});
export const photoRoutes = async (fastify) => {
    /**
     * GET /api/photos
     * Global photo gallery list across all projects for Admin Photos Manager
     */
    fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const queryCheck = globalPhotosQuerySchema.safeParse(request.query);
        if (!queryCheck.success) {
            return reply.status(400).send({
                success: false,
                error: {
                    code: 'INVALID_QUERY',
                    message: 'Invalid query parameters',
                    details: queryCheck.error.flatten(),
                },
            });
        }
        try {
            const result = await projectPhotoService.getGlobalPhotos(queryCheck.data, request.user);
            return reply.send({ success: true, ...result });
        }
        catch (err) {
            if (err instanceof PhotoError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve photos' },
            });
        }
    });
    /**
     * GET /api/photos/:photoId/file
     * Stream the binary image file directly for <img> tags
     */
    fastify.get('/:photoId/file', async (request, reply) => {
        const paramCheck = photoIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_PARAMS', message: 'Invalid photo UUID format' },
            });
        }
        try {
            const photo = await projectPhotoService.getPhotoById(paramCheck.data.photoId);
            if (!photo || !photo.photoUrl) {
                return reply.status(404).send({ error: 'Photo not found' });
            }
            // If stored as base64 dataUri, parse and stream as binary buffer
            if (photo.photoUrl.startsWith('data:image')) {
                const match = photo.photoUrl.match(/^data:([^;]+);base64,(.+)$/);
                const mime = match ? match[1] : 'image/jpeg';
                const buffer = Buffer.from(match ? match[2] : photo.photoUrl, 'base64');
                reply.header('Content-Type', mime);
                reply.header('Cache-Control', 'public, max-age=86400');
                return reply.send(buffer);
            }
            // If local file on disk exists, stream it
            if (storageService.fileExists(photo.photoUrl)) {
                reply.header('Content-Type', 'image/jpeg');
                return reply.send(storageService.getReadStream(photo.photoUrl));
            }
            return reply.status(404).send({ error: 'Image file not found' });
        }
        catch (err) {
            return reply.status(500).send({ error: 'Failed to stream photo' });
        }
    });
    /**
     * PATCH /api/photos/:photoId
     * Edit photo details (title, phase, craftsman, caption, etc.)
     */
    fastify.patch('/:photoId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const paramCheck = photoIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_PARAMS', message: 'Invalid photo UUID format' },
            });
        }
        const bodyCheck = updatePhotoSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Validation failed for photo update',
                    details: bodyCheck.error.flatten(),
                },
            });
        }
        try {
            const updated = await projectPhotoService.updatePhoto(paramCheck.data.photoId, bodyCheck.data, request.user);
            return reply.send({ success: true, data: updated });
        }
        catch (err) {
            if (err instanceof PhotoError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to update photo' },
            });
        }
    });
    /**
     * PATCH /api/photos/:photoId/visibility
     * Fast toggle customer visibility
     */
    fastify.patch('/:photoId/visibility', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const paramCheck = photoIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_PARAMS', message: 'Invalid photo UUID format' },
            });
        }
        const bodyCheck = toggleVisibilitySchema.safeParse(request.body || {});
        const explicit = bodyCheck.success ? bodyCheck.data.visibleToCustomer : undefined;
        try {
            const updated = await projectPhotoService.toggleVisibility(paramCheck.data.photoId, request.user, explicit);
            return reply.send({ success: true, data: updated });
        }
        catch (err) {
            if (err instanceof PhotoError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to toggle photo visibility' },
            });
        }
    });
    /**
     * DELETE /api/photos/:photoId
     * Delete photo record and purge physical file
     */
    fastify.delete('/:photoId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const paramCheck = photoIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_PARAMS', message: 'Invalid photo UUID format' },
            });
        }
        try {
            const result = await projectPhotoService.deletePhoto(paramCheck.data.photoId, request.user);
            return reply.send(result);
        }
        catch (err) {
            if (err instanceof PhotoError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to delete photo' },
            });
        }
    });
};
