import type { FastifyPluginAsync } from 'fastify';
import {
  candidateQuerySchema,
  createCandidateSchema,
  updateCandidateSchema,
  updateCandidateStageSchema,
  convertCandidateSchema,
  candidateIdParamSchema,
} from './candidate.schema.js';
import { candidateService, CandidateError } from './candidate.service.js';

export const partnerCandidateRoutes: FastifyPluginAsync = async (fastify) => {
  // All candidate routes are strictly Admin-only
  const adminGuard = {
    preHandler: [fastify.authenticate, fastify.authorize(['admin'])],
  };

  /**
   * 1. GET /api/partner-candidates
   * List prospective candidates with Kanban counts
   */
  fastify.get('/', adminGuard, async (request, reply) => {
    const parseResult = candidateQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid candidate query parameters',
          details: parseResult.error.format(),
        },
      });
    }

    try {
      const result = await candidateService.list(parseResult.data);
      return reply.status(200).send({
        success: true,
        data: result,
      });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve candidates' },
      });
    }
  });

  /**
   * 2. GET /api/partner-candidates/:id
   * Get single candidate by ID
   */
  fastify.get('/:id', adminGuard, async (request, reply) => {
    const paramResult = candidateIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ID', message: 'Invalid candidate UUID parameter' },
      });
    }

    try {
      const candidate = await candidateService.getById(paramResult.data.id);
      return reply.status(200).send({
        success: true,
        data: candidate,
      });
    } catch (err: any) {
      if (err instanceof CandidateError) {
        return reply.status(err.statusCode).send({
          success: false,
          error: { code: err.code, message: err.message },
        });
      }
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve candidate' },
      });
    }
  });

  /**
   * 3. POST /api/partner-candidates
   * Create new candidate in pipeline
   */
  fastify.post('/', adminGuard, async (request, reply) => {
    const parseResult = createCandidateSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid candidate payload',
          details: parseResult.error.format(),
        },
      });
    }

    try {
      const created = await candidateService.create(parseResult.data);
      return reply.status(201).send({
        success: true,
        message: `Candidate ${created.name} added to pipeline (${created.candidateNumber})`,
        data: created,
      });
    } catch (err: any) {
      if (err instanceof CandidateError) {
        return reply.status(err.statusCode).send({
          success: false,
          error: { code: err.code, message: err.message },
        });
      }
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create candidate' },
      });
    }
  });

  /**
   * 4. PATCH /api/partner-candidates/:id
   * Update candidate attributes
   */
  fastify.patch('/:id', adminGuard, async (request, reply) => {
    const paramResult = candidateIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ID', message: 'Invalid candidate UUID parameter' },
      });
    }

    const parseResult = updateCandidateSchema.safeParse(request.body);
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

    try {
      const updated = await candidateService.update(paramResult.data.id, parseResult.data);
      return reply.status(200).send({
        success: true,
        message: 'Candidate updated successfully',
        data: updated,
      });
    } catch (err: any) {
      if (err instanceof CandidateError) {
        return reply.status(err.statusCode).send({
          success: false,
          error: { code: err.code, message: err.message },
        });
      }
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update candidate' },
      });
    }
  });

  /**
   * 5. PATCH /api/partner-candidates/:id/stage
   * Advance or change candidate Kanban stage
   */
  fastify.patch('/:id/stage', adminGuard, async (request, reply) => {
    const paramResult = candidateIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ID', message: 'Invalid candidate UUID parameter' },
      });
    }

    const parseResult = updateCandidateStageSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid stage update payload',
          details: parseResult.error.format(),
        },
      });
    }

    try {
      const updated = await candidateService.updateStage(
        paramResult.data.id,
        parseResult.data.stage,
        parseResult.data.notes
      );
      return reply.status(200).send({
        success: true,
        message: `Candidate moved to stage: ${updated.stage}`,
        data: updated,
      });
    } catch (err: any) {
      if (err instanceof CandidateError) {
        return reply.status(err.statusCode).send({
          success: false,
          error: { code: err.code, message: err.message },
        });
      }
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update candidate stage' },
      });
    }
  });

  /**
   * 6. POST /api/partner-candidates/:id/convert
   * Atomic conversion: converts candidate to official partner with login credentials
   */
  fastify.post('/:id/convert', adminGuard, async (request, reply) => {
    const paramResult = candidateIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ID', message: 'Invalid candidate UUID parameter' },
      });
    }

    const parseResult = convertCandidateSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid conversion payload',
          details: parseResult.error.format(),
        },
      });
    }

    try {
      const result = await candidateService.convert(paramResult.data.id, parseResult.data);
      return reply.status(201).send({
        success: true,
        message: `Candidate successfully converted to official partner (${result.partner.partnerCode})`,
        data: result,
      });
    } catch (err: any) {
      if (err instanceof CandidateError) {
        return reply.status(err.statusCode).send({
          success: false,
          error: { code: err.code, message: err.message },
        });
      }
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err?.message || 'Failed to convert candidate' },
      });
    }
  });

  /**
   * 7. DELETE /api/partner-candidates/:id
   * Delete or archive candidate
   */
  fastify.delete('/:id', adminGuard, async (request, reply) => {
    const paramResult = candidateIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ID', message: 'Invalid candidate UUID parameter' },
      });
    }

    try {
      const result = await candidateService.delete(paramResult.data.id);
      return reply.status(200).send({
        success: true,
        message: 'Candidate deleted successfully',
        data: result,
      });
    } catch (err: any) {
      if (err instanceof CandidateError) {
        return reply.status(err.statusCode).send({
          success: false,
          error: { code: err.code, message: err.message },
        });
      }
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete candidate' },
      });
    }
  });
};
