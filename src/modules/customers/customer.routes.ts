import type { FastifyPluginAsync } from 'fastify';
import {
  customerQuerySchema,
  createCustomerSchema,
  updateCustomerSchema,
  customerIdParamSchema,
} from './customer.schema.js';
import { customerService, CustomerError } from './customer.service.js';

export const customerRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/customers
   * Lists customers with search, city filter, sorting, and pagination
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] },
    async (request, reply) => {
      const parseResult = customerQuerySchema.safeParse(request.query);
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
        const result = await customerService.list(parseResult.data);
        return reply.status(200).send({
          success: true,
          data: result,
        });
      } catch (err: any) {
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve customers' },
        });
      }
    }
  );

  /**
   * GET /api/customers/:id
   * Customer dossier with linked projects, quotes, invoices, and financial totals
   */
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const paramResult = customerIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ID', message: 'Invalid customer UUID parameter' },
      });
    }

    try {
      const dossier = await customerService.getDossier(paramResult.data.id);

      // Customer isolation check: Customers can ONLY see their own dossier
      const effectiveRole = request.effectiveRole || request.user.role;
      if (effectiveRole === 'customer') {
        const isOwner =
          dossier.userId === request.user.sub ||
          dossier.id === request.user.profileId ||
          dossier.id === request.effectiveProfileId;

        if (!isOwner) {
          return reply.status(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Access denied. You may only view your own customer dossier.' },
          });
        }
      }

      return reply.status(200).send({
        success: true,
        data: dossier,
      });
    } catch (err: any) {
      if (err instanceof CustomerError) {
        return reply.status(err.statusCode).send({
          success: false,
          error: { code: err.code, message: err.message },
        });
      }
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve customer dossier' },
      });
    }
  });

  /**
   * POST /api/customers
   * Create new customer (Admin only)
   */
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const parseResult = createCustomerSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid customer payload',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const created = await customerService.create(parseResult.data);
        return reply.status(201).send({
          success: true,
          message: 'Customer created successfully',
          data: created,
        });
      } catch (err: any) {
        if (err instanceof CustomerError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to create customer' },
        });
      }
    }
  );

  /**
   * PATCH /api/customers/:id
   * Update customer record (Admin only)
   */
  fastify.patch(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const paramResult = customerIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid customer UUID parameter' },
        });
      }

      const parseResult = updateCustomerSchema.safeParse(request.body);
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
        const updated = await customerService.update(paramResult.data.id, parseResult.data);
        return reply.status(200).send({
          success: true,
          message: 'Customer updated successfully',
          data: updated,
        });
      } catch (err: any) {
        if (err instanceof CustomerError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to update customer' },
        });
      }
    }
  );

  /**
   * DELETE /api/customers/:id
   * Delete customer with active dependency protection (Admin only)
   */
  fastify.delete(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const paramResult = customerIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid customer UUID parameter' },
        });
      }

      try {
        const result = await customerService.delete(paramResult.data.id);
        return reply.status(200).send({
          success: true,
          message: `Customer ${result.customerNumber} deleted successfully`,
          data: result,
        });
      } catch (err: any) {
        if (err instanceof CustomerError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to delete customer' },
        });
      }
    }
  );
};
