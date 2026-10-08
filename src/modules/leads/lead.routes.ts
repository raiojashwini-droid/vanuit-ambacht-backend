import type { FastifyPluginAsync } from 'fastify';
import {
  leadQuerySchema,
  createLeadSchema,
  updateLeadSchema,
  updateStepSchema,
  updateStatusSchema,
  addVoiceNoteSchema,
  updateVoiceNoteSchema,
  addCommercialActionSchema,
  leadIdParamSchema,
  voiceNoteParamSchema,
} from './lead.schema.js';
import { leadService, LeadError } from './lead.service.js';

export const leadRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/leads
   * List leads with search, status filters, workflow step filter, and pagination
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const parseResult = leadQuerySchema.safeParse(request.query);
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
        const result = await leadService.list(parseResult.data);
        return reply.status(200).send({
          success: true,
          data: result,
        });
      } catch (err: any) {
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve leads' },
        });
      }
    }
  );

  /**
   * GET /api/leads/:id
   * Complete Lead Dossier with voice notes, commercial actions, and linked customer
   */
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const paramResult = leadIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid lead UUID parameter' },
        });
      }

      try {
        const dossier = await leadService.getDossier(paramResult.data.id);
        return reply.status(200).send({
          success: true,
          data: dossier,
        });
      } catch (err: any) {
        if (err instanceof LeadError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve lead dossier' },
        });
      }
    }
  );

  /**
   * POST /api/leads
   * Create new intake lead (Admin only)
   */
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const parseResult = createLeadSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid lead payload',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const created = await leadService.create(parseResult.data, request.user.sub);
        return reply.status(201).send({
          success: true,
          message: 'Lead created successfully',
          data: created,
        });
      } catch (err: any) {
        if (err instanceof LeadError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to create lead' },
        });
      }
    }
  );

  /**
   * PATCH /api/leads/:id
   * Update lead info
   */
  fastify.patch(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const paramResult = leadIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid lead UUID parameter' },
        });
      }

      const parseResult = updateLeadSchema.safeParse(request.body);
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
        const updated = await leadService.update(paramResult.data.id, parseResult.data);
        return reply.status(200).send({
          success: true,
          message: 'Lead updated successfully',
          data: updated,
        });
      } catch (err: any) {
        if (err instanceof LeadError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to update lead' },
        });
      }
    }
  );

  /**
   * PATCH /api/leads/:id/step
   * Advance or set workflow step (1 through 8)
   */
  fastify.patch(
    '/:id/step',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const paramResult = leadIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid lead UUID parameter' },
        });
      }

      const parseResult = updateStepSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid step payload. Workflow step must be between 1 and 8.',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const updated = await leadService.updateStep(paramResult.data.id, parseResult.data.workflowStep);
        return reply.status(200).send({
          success: true,
          message: `Lead advanced to step ${parseResult.data.workflowStep}`,
          data: updated,
        });
      } catch (err: any) {
        if (err instanceof LeadError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to update lead step' },
        });
      }
    }
  );

  /**
   * PATCH /api/leads/:id/status
   * Update lead status (e.g. Won, Lost with reason)
   */
  fastify.patch(
    '/:id/status',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const paramResult = leadIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid lead UUID parameter' },
        });
      }

      const parseResult = updateStatusSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid status payload',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const updated = await leadService.updateStatus(
          paramResult.data.id,
          parseResult.data.status,
          parseResult.data.lostReason
        );
        return reply.status(200).send({
          success: true,
          message: `Lead status updated to '${parseResult.data.status}'`,
          data: updated,
        });
      } catch (err: any) {
        if (err instanceof LeadError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to update lead status' },
        });
      }
    }
  );

  /**
   * POST /api/leads/:id/voice-notes
   * Upload / Record Plaud AI Voice Note
   */
  fastify.post(
    '/:id/voice-notes',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const paramResult = leadIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid lead UUID parameter' },
        });
      }

      const parseResult = addVoiceNoteSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid voice note payload',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const voiceNote = await leadService.addVoiceNote(
          paramResult.data.id,
          parseResult.data,
          request.user.sub
        );
        return reply.status(201).send({
          success: true,
          message: 'Plaud AI voice note recorded successfully',
          data: voiceNote,
        });
      } catch (err: any) {
        if (err instanceof LeadError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to add voice note' },
        });
      }
    }
  );

  /**
   * PATCH /api/leads/:id/voice-notes/:vnId
   * Update AI transcript or summary of a voice note
   */
  fastify.patch(
    '/:id/voice-notes/:vnId',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const paramResult = voiceNoteParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid lead or voice note UUID parameter' },
        });
      }

      const parseResult = updateVoiceNoteSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid voice note update payload',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const updated = await leadService.updateVoiceNote(
          paramResult.data.id,
          paramResult.data.vnId,
          parseResult.data
        );
        return reply.status(200).send({
          success: true,
          message: 'Voice note updated successfully',
          data: updated,
        });
      } catch (err: any) {
        if (err instanceof LeadError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to update voice note' },
        });
      }
    }
  );

  /**
   * POST /api/leads/:id/commercial-actions
   * Record commercial consultation note with optional follow-up task
   */
  fastify.post(
    '/:id/commercial-actions',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const paramResult = leadIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid lead UUID parameter' },
        });
      }

      const parseResult = addCommercialActionSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid commercial action payload',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const action = await leadService.addCommercialAction(
          paramResult.data.id,
          parseResult.data,
          request.user.sub
        );
        return reply.status(201).send({
          success: true,
          message: parseResult.data.createTask
            ? 'Commercial action & task recorded successfully'
            : 'Commercial action recorded successfully',
          data: action,
        });
      } catch (err: any) {
        if (err instanceof LeadError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to record commercial action' },
        });
      }
    }
  );

  /**
   * POST /api/leads/:id/convert-customer
   * 1-Click Transactional Lead-to-Customer conversion
   */
  fastify.post(
    '/:id/convert-customer',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const paramResult = leadIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid lead UUID parameter' },
        });
      }

      try {
        const result = await leadService.convertToCustomer(paramResult.data.id);
        return reply.status(200).send({
          success: true,
          message: `Lead converted to customer ${result.customer.customerNumber}`,
          data: result,
        });
      } catch (err: any) {
        if (err instanceof LeadError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to convert lead to customer' },
        });
      }
    }
  );

  /**
   * DELETE /api/leads/:id
   * Delete lead (Admin only)
   */
  fastify.delete(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const paramResult = leadIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid lead UUID parameter' },
        });
      }

      try {
        const result = await leadService.delete(paramResult.data.id);
        return reply.status(200).send({
          success: true,
          message: `Lead ${result.leadNumber} deleted successfully`,
          data: result,
        });
      } catch (err: any) {
        if (err instanceof LeadError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to delete lead' },
        });
      }
    }
  );
};
