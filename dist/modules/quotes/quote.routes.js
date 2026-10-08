import { quoteQuerySchema, createQuoteSchema, updateQuoteSchema, saveDraftVersionSchema, publishQuoteSchema, acceptAndConvertSchema, quoteIdParamSchema, } from './quote.schema.js';
import { quoteService, QuoteError } from './quote.service.js';
export const quoteRoutes = async (fastify) => {
    /**
     * GET /api/quotes
     * List quotes with search, filters & pagination
     */
    fastify.get('/', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'customer'])] }, async (request, reply) => {
        const parseResult = quoteQuerySchema.safeParse(request.query);
        if (!parseResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_FAILED', message: 'Invalid query parameters', details: parseResult.error.format() },
            });
        }
        try {
            const result = await quoteService.list(parseResult.data, request.user);
            return reply.status(200).send({ success: true, data: result });
        }
        catch (err) {
            if (err instanceof QuoteError) {
                return reply.status(err.statusCode).send({ success: false, error: { code: err.code, message: err.message } });
            }
            fastify.log.error(err);
            return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve quotes' } });
        }
    });
    /**
     * GET /api/quotes/:id
     * Complete Quote Dossier with versions & line items
     */
    fastify.get('/:id', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'customer'])] }, async (request, reply) => {
        const paramResult = quoteIdParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Invalid quote ID' } });
        }
        try {
            const result = await quoteService.getById(paramResult.data.id, request.user);
            return reply.status(200).send({ success: true, data: result });
        }
        catch (err) {
            if (err instanceof QuoteError) {
                return reply.status(err.statusCode).send({ success: false, error: { code: err.code, message: err.message } });
            }
            fastify.log.error(err);
            return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve quote dossier' } });
        }
    });
    /**
     * POST /api/quotes
     * Admin initializes new quote draft
     */
    fastify.post('/', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const parseResult = createQuoteSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_FAILED', message: 'Invalid quote creation payload', details: parseResult.error.format() },
            });
        }
        try {
            const created = await quoteService.create(parseResult.data, request.user.sub);
            return reply.status(201).send({
                success: true,
                message: `Quote ${created.quoteNumber} created successfully`,
                data: created,
            });
        }
        catch (err) {
            if (err instanceof QuoteError) {
                return reply.status(err.statusCode).send({ success: false, error: { code: err.code, message: err.message } });
            }
            fastify.log.error(err);
            return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create quote' } });
        }
    });
    /**
     * PATCH /api/quotes/:id
     * Admin updates top-level quote properties
     */
    fastify.patch('/:id', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramResult = quoteIdParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Invalid quote ID' } });
        }
        const parseResult = updateQuoteSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_FAILED', message: 'Invalid update payload', details: parseResult.error.format() },
            });
        }
        try {
            const updated = await quoteService.update(paramResult.data.id, parseResult.data, request.user.sub);
            return reply.status(200).send({ success: true, message: 'Quote updated successfully', data: updated });
        }
        catch (err) {
            if (err instanceof QuoteError) {
                return reply.status(err.statusCode).send({ success: false, error: { code: err.code, message: err.message } });
            }
            fastify.log.error(err);
            return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update quote' } });
        }
    });
    /**
     * PUT /api/quotes/:id/versions/draft
     * Autosave 6-step proposal draft
     */
    fastify.put('/:id/versions/draft', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramResult = quoteIdParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Invalid quote ID' } });
        }
        const parseResult = saveDraftVersionSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_FAILED', message: 'Invalid draft proposal payload', details: parseResult.error.format() },
            });
        }
        try {
            const updated = await quoteService.saveDraftVersion(paramResult.data.id, parseResult.data, request.user.sub);
            return reply.status(200).send({ success: true, message: 'Quote draft autosaved successfully', data: updated });
        }
        catch (err) {
            if (err instanceof QuoteError) {
                return reply.status(err.statusCode).send({ success: false, error: { code: err.code, message: err.message } });
            }
            fastify.log.error(err);
            return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to autosave quote draft' } });
        }
    });
    /**
     * POST /api/quotes/:id/publish
     * Publish & send official quote proposal
     */
    fastify.post('/:id/publish', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramResult = quoteIdParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Invalid quote ID' } });
        }
        const parseResult = publishQuoteSchema.safeParse(request.body || {});
        if (!parseResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_FAILED', message: 'Invalid publish payload', details: parseResult.error.format() },
            });
        }
        try {
            const published = await quoteService.publish(paramResult.data.id, parseResult.data, request.user.sub);
            return reply.status(200).send({
                success: true,
                message: `Quote ${published.quoteNumber} published successfully`,
                data: published,
            });
        }
        catch (err) {
            if (err instanceof QuoteError) {
                return reply.status(err.statusCode).send({ success: false, error: { code: err.code, message: err.message } });
            }
            fastify.log.error(err);
            return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to publish quote' } });
        }
    });
    /**
     * POST /api/quotes/:id/duplicate
     * Clone quote into new independent draft
     */
    fastify.post('/:id/duplicate', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramResult = quoteIdParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Invalid quote ID' } });
        }
        try {
            const duplicated = await quoteService.duplicate(paramResult.data.id, request.user.sub);
            return reply.status(201).send({
                success: true,
                message: `Quote duplicated as ${duplicated.quoteNumber}`,
                data: duplicated,
            });
        }
        catch (err) {
            if (err instanceof QuoteError) {
                return reply.status(err.statusCode).send({ success: false, error: { code: err.code, message: err.message } });
            }
            fastify.log.error(err);
            return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to duplicate quote' } });
        }
    });
    /**
     * DELETE /api/quotes/:id
     * Cascading quote deletion
     */
    fastify.delete('/:id', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramResult = quoteIdParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Invalid quote ID' } });
        }
        try {
            await quoteService.delete(paramResult.data.id, request.user.sub);
            return reply.status(200).send({ success: true, message: 'Quote deleted successfully' });
        }
        catch (err) {
            if (err instanceof QuoteError) {
                return reply.status(err.statusCode).send({ success: false, error: { code: err.code, message: err.message } });
            }
            fastify.log.error(err);
            return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete quote' } });
        }
    });
    /**
     * POST /api/quotes/:id/accept-and-convert
     * Admin manual approval and conversion to Project + 2 Invoices
     */
    fastify.post('/:id/accept-and-convert', { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] }, async (request, reply) => {
        const paramResult = quoteIdParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Invalid quote ID' } });
        }
        const parseResult = acceptAndConvertSchema.safeParse(request.body || {});
        if (!parseResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_FAILED', message: 'Invalid payload', details: parseResult.error.format() },
            });
        }
        try {
            const result = await quoteService.acceptAndConvert(paramResult.data.id, parseResult.data.note, request.user.sub);
            return reply.status(200).send({
                success: true,
                message: `Quote ${result.quote.quoteNumber} approved and converted to project ${result.project.projectNumber}`,
                data: result,
            });
        }
        catch (err) {
            if (err instanceof QuoteError) {
                return reply.status(err.statusCode).send({ success: false, error: { code: err.code, message: err.message } });
            }
            fastify.log.error(err);
            return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to convert quote' } });
        }
    });
    /**
     * GET /api/quotes/:id/pdf
     * Download official 6-page Offerte PDF
     */
    fastify.get('/:id/pdf', { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'customer'])] }, async (request, reply) => {
        const paramResult = quoteIdParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Invalid quote ID' } });
        }
        try {
            const { buffer, fileName } = await quoteService.generatePdf(paramResult.data.id, request.user);
            reply.header('Content-Type', 'application/pdf');
            reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
            reply.header('Content-Length', buffer.length);
            return reply.send(buffer);
        }
        catch (err) {
            if (err instanceof QuoteError) {
                return reply.status(err.statusCode).send({ success: false, error: { code: err.code, message: err.message } });
            }
            fastify.log.error(err);
            return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to generate quote PDF' } });
        }
    });
};
