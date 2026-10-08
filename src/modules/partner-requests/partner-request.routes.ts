import type { FastifyPluginAsync } from 'fastify';
import {
  partnerRequestQuerySchema,
  createPartnerRequestSchema,
  updatePartnerRequestSchema,
  submitOfferSchema,
  selectOfferSchema,
  declineRequestSchema,
  requestIdParamSchema,
} from './partner-request.schema.js';
import { partnerRequestService, PartnerRequestError } from './partner-request.service.js';

export const partnerRequestRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/partner-requests
   * List partner inquiries with role-based scoping, search, filters & pagination
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] },
    async (request, reply) => {
      const parseResult = partnerRequestQuerySchema.safeParse(request.query);
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
        const result = await partnerRequestService.list(parseResult.data, request.user);
        return reply.status(200).send({
          success: true,
          data: result,
        });
      } catch (err: any) {
        if (err instanceof PartnerRequestError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve partner price requests' },
        });
      }
    }
  );

  /**
   * GET /api/partner-requests/:id
   * Complete Partner Price Request Dossier with specifications, attachments & submitted offers
   */
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] },
    async (request, reply) => {
      const paramResult = requestIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid partner price request UUID' },
        });
      }

      try {
        const result = await partnerRequestService.getById(paramResult.data.id, request.user);
        return reply.status(200).send({
          success: true,
          data: result,
        });
      } catch (err: any) {
        if (err instanceof PartnerRequestError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve partner price request dossier' },
        });
      }
    }
  );

  /**
   * POST /api/partner-requests
   * Admin creates a new partner price request inquiry (atomic transaction)
   */
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const parseResult = createPartnerRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid partner price request payload',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const created = await partnerRequestService.create(parseResult.data, request.user.sub);
        return reply.status(201).send({
          success: true,
          message: `Partner price request ${created.requestNumber} created successfully`,
          data: created,
        });
      } catch (err: any) {
        if (err instanceof PartnerRequestError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to create partner price request' },
        });
      }
    }
  );

  /**
   * PATCH /api/partner-requests/:id
   * Admin updates inquiry specifications before final offer selection
   */
  fastify.patch(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const paramResult = requestIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid partner price request UUID' },
        });
      }

      const parseResult = updatePartnerRequestSchema.safeParse(request.body);
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
        const updated = await partnerRequestService.update(
          paramResult.data.id,
          parseResult.data,
          request.user.sub
        );
        return reply.status(200).send({
          success: true,
          message: 'Partner price request updated successfully',
          data: updated,
        });
      } catch (err: any) {
        if (err instanceof PartnerRequestError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to update partner price request' },
        });
      }
    }
  );

  /**
   * POST /api/partner-requests/:id/offers
   * Partner submits price bid with full structured cost breakdown (atomic transaction)
   */
  fastify.post(
    '/:id/offers',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] },
    async (request, reply) => {
      const paramResult = requestIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid partner price request UUID' },
        });
      }

      const parseResult = submitOfferSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid offer payload',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const createdOffer = await partnerRequestService.submitOffer(
          paramResult.data.id,
          parseResult.data,
          request.user
        );
        return reply.status(201).send({
          success: true,
          message: `Partner offer ${createdOffer.offerNumber} submitted successfully (Revision ${createdOffer.revisionNumber})`,
          data: createdOffer,
        });
      } catch (err: any) {
        if (err instanceof PartnerRequestError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to submit partner offer' },
        });
      }
    }
  );

  /**
   * GET /api/partner-requests/:id/offers
   * List offer revision history for a price request
   */
  fastify.get(
    '/:id/offers',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] },
    async (request, reply) => {
      const paramResult = requestIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid partner price request UUID' },
        });
      }

      try {
        const offers = await partnerRequestService.getOffers(paramResult.data.id, request.user);
        return reply.status(200).send({
          success: true,
          data: offers,
        });
      } catch (err: any) {
        if (err instanceof PartnerRequestError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve offers' },
        });
      }
    }
  );

  /**
   * PATCH /api/partner-requests/:id/select-offer
   * Admin selects winning offer (atomic transaction)
   */
  fastify.patch(
    '/:id/select-offer',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const paramResult = requestIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid partner price request UUID' },
        });
      }

      const parseResult = selectOfferSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid select offer payload',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const result = await partnerRequestService.selectOffer(
          paramResult.data.id,
          parseResult.data,
          request.user.sub
        );
        return reply.status(200).send({
          success: true,
          message: `Offer ${result.selectedOffer.offerNumber} selected successfully`,
          data: result,
        });
      } catch (err: any) {
        if (err instanceof PartnerRequestError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to select offer' },
        });
      }
    }
  );

  /**
   * POST /api/partner-requests/:id/decline
   * Partner declines inquiry with reason (atomic transaction)
   */
  fastify.post(
    '/:id/decline',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] },
    async (request, reply) => {
      const paramResult = requestIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid partner price request UUID' },
        });
      }

      const parseResult = declineRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid decline payload',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const updated = await partnerRequestService.decline(
          paramResult.data.id,
          parseResult.data,
          request.user
        );
        return reply.status(200).send({
          success: true,
          message: 'Partner price request marked as declined',
          data: updated,
        });
      } catch (err: any) {
        if (err instanceof PartnerRequestError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to decline partner price request' },
        });
      }
    }
  );
};
