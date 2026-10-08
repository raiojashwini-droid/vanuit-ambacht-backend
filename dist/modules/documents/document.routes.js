import { z } from 'zod';
import { documentService, DocumentError } from './document.service.js';
import { createDocumentSchema, updateDocumentSchema, documentQuerySchema, } from './document.types.js';
import { storageService } from '../../services/storage.service.js';
const documentIdParamSchema = z.object({
    id: z.string().uuid('Invalid document UUID'),
});
export const documentRoutes = async (fastify) => {
    /**
     * GET /api/documents
     * List all documents with filters, search, and RBAC scoping
     */
    fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const queryCheck = documentQuerySchema.safeParse(request.query);
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
        const result = await documentService.getDocuments(queryCheck.data, request.user);
        return reply.send({ success: true, ...result });
    });
    /**
     * GET /api/documents/:id
     * Get single document metadata
     */
    fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const paramResult = documentIdParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid document UUID format' },
            });
        }
        try {
            const doc = await documentService.getDocumentById(paramResult.data.id, request.user);
            return reply.send({ success: true, data: doc });
        }
        catch (err) {
            if (err instanceof DocumentError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            request.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve document' },
            });
        }
    });
    /**
     * POST /api/documents
     * Upload document to vault (base64 / multipart)
     */
    fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const bodyCheck = createDocumentSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Validation failed for document upload',
                    details: bodyCheck.error.flatten(),
                },
            });
        }
        try {
            const created = await documentService.uploadDocument(bodyCheck.data, request.user);
            return reply.status(201).send({ success: true, data: created });
        }
        catch (err) {
            if (err instanceof DocumentError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            return reply.status(400).send({
                success: false,
                error: { code: 'UPLOAD_FAILED', message: err.message || 'Failed to upload document' },
            });
        }
    });
    /**
     * PATCH /api/documents/:id
     * Update document metadata
     */
    fastify.patch('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const paramResult = documentIdParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid document UUID format' },
            });
        }
        const bodyCheck = updateDocumentSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Validation failed for document update',
                    details: bodyCheck.error.flatten(),
                },
            });
        }
        try {
            const updated = await documentService.updateDocument(paramResult.data.id, bodyCheck.data, request.user);
            return reply.send({ success: true, data: updated });
        }
        catch (err) {
            if (err instanceof DocumentError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to update document' },
            });
        }
    });
    /**
     * DELETE /api/documents/:id
     * Delete document record and purge physical file
     */
    fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const paramResult = documentIdParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid document UUID format' },
            });
        }
        try {
            const result = await documentService.deleteDocument(paramResult.data.id, request.user);
            return reply.send(result);
        }
        catch (err) {
            if (err instanceof DocumentError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to delete document' },
            });
        }
    });
    /**
     * GET /api/documents/:id/download
     * Secure, authorized document download for admin, assigned partners, and customers
     */
    fastify.get('/:id/download', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const paramResult = documentIdParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid document UUID format' },
            });
        }
        const { db } = await import('../../db/index.js');
        const { documents } = await import('../../db/schema.js');
        const { eq } = await import('drizzle-orm');
        const [document] = await db
            .select()
            .from(documents)
            .where(eq(documents.id, paramResult.data.id))
            .limit(1);
        if (!document) {
            return reply.status(404).send({
                success: false,
                error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' },
            });
        }
        const { authorized } = await documentService.verifyDocumentAccess(document, request.user);
        if (!authorized) {
            return reply.status(403).send({
                success: false,
                error: { code: 'FORBIDDEN', message: 'You are not authorized to download this document' },
            });
        }
        const rawFileName = document.fileName || 'attachment';
        const safeFileName = storageService.sanitizeFileName(rawFileName);
        const mimeType = document.mimeType || 'application/octet-stream';
        reply.header('Content-Type', mimeType);
        reply.header('Content-Disposition', `attachment; filename="${safeFileName}"`);
        // Check if file exists on disk and is within upload base dir
        if (document.fileUrl && storageService.fileExists(document.fileUrl)) {
            const stream = storageService.getReadStream(document.fileUrl);
            return reply.send(stream);
        }
        // If simulated or test document, return simulated buffer with document info
        const dummyPayload = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Title (${safeFileName}) /Category (${document.category || 'General'}) /Creator (Vanuit Ambacht Platform) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`);
        reply.header('Content-Length', dummyPayload.length);
        return reply.send(dummyPayload);
    });
};
