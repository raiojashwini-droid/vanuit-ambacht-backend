import { tokenParamSchema, approveOfferteSchema, rejectOfferteSchema, } from './quote.schema.js';
import { quoteService, QuoteError } from './quote.service.js';
export const publicOfferteRoutes = async (fastify) => {
    /**
     * GET /api/offerte/:token
     * Public customer-facing proposal endpoint (Strictly sanitized)
     */
    fastify.get('/:token', async (request, reply) => {
        const paramResult = tokenParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_TOKEN', message: 'Invalid proposal token or quote number format' },
            });
        }
        try {
            const result = await quoteService.getByPublicToken(paramResult.data.token);
            return reply.status(200).send({ success: true, data: result });
        }
        catch (err) {
            if (err instanceof QuoteError) {
                return reply.status(err.statusCode).send({ success: false, error: { code: err.code, message: err.message } });
            }
            fastify.log.error(err);
            return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve proposal' } });
        }
    });
    /**
     * GET /api/offerte/:token/pdf
     * Public download of official 6-page proposal PDF
     */
    fastify.get('/:token/pdf', async (request, reply) => {
        const paramResult = tokenParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_TOKEN', message: 'Invalid proposal token' },
            });
        }
        try {
            const { buffer, fileName } = await quoteService.generatePublicPdf(paramResult.data.token);
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
            return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to generate proposal PDF' } });
        }
    });
    /**
     * POST /api/offerte/:token/approve
     * Customer digital approval via public token (atomic transaction with replay & expiration guards)
     */
    fastify.post('/:token/approve', async (request, reply) => {
        const paramResult = tokenParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_TOKEN', message: 'Invalid proposal token' },
            });
        }
        const parseResult = approveOfferteSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_FAILED', message: 'Invalid approval submission', details: parseResult.error.format() },
            });
        }
        try {
            const clientIp = request.ip || request.headers['x-forwarded-for'] || '127.0.0.1';
            const userAgent = request.headers['user-agent'] || 'Unknown';
            const result = await quoteService.approveByPublicToken(paramResult.data.token, parseResult.data, clientIp, userAgent);
            return reply.status(200).send({
                success: true,
                message: `Offerte ${result.quoteNumber} succesvol digitaal ondertekend en goedgekeurd`,
                data: result,
            });
        }
        catch (err) {
            if (err instanceof QuoteError) {
                return reply.status(err.statusCode).send({ success: false, error: { code: err.code, message: err.message } });
            }
            fastify.log.error(err);
            return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to process approval' } });
        }
    });
    /**
     * POST /api/offerte/:token/reject
     * Customer declines or requests modification on proposal
     */
    fastify.post('/:token/reject', async (request, reply) => {
        const paramResult = tokenParamSchema.safeParse(request.params);
        if (!paramResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_TOKEN', message: 'Invalid proposal token' },
            });
        }
        const parseResult = rejectOfferteSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_FAILED', message: 'Invalid decline payload', details: parseResult.error.format() },
            });
        }
        try {
            const result = await quoteService.rejectByPublicToken(paramResult.data.token, parseResult.data);
            return reply.status(200).send({
                success: true,
                message: 'Proposal decline feedback received',
                data: result,
            });
        }
        catch (err) {
            if (err instanceof QuoteError) {
                return reply.status(err.statusCode).send({ success: false, error: { code: err.code, message: err.message } });
            }
            fastify.log.error(err);
            return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to process decline' } });
        }
    });
};
