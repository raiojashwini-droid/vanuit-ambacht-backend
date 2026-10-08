import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { projectService, ProjectError } from './project.service.js';
import { projectPhotoService, PhotoError } from './project-photo.service.js';
import { createPhotoSchema } from './project.schema.js';

const projectIdParamSchema = z.object({
  id: z.string().uuid('Invalid project UUID'),
});

export const partnerProjectRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/partner/projects
   * Partner gets assigned projects with strict financial redaction
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate, fastify.authorize(['partner', 'admin'])] },
    async (request, reply) => {
      const query = request.query as any;
      const page = Number(query.page) || 1;
      const limit = Number(query.limit) || 25;

      const result = await projectService.listProjects(
        {
          page,
          limit,
          sort: query.sort || 'createdAt:desc',
          status: query.status,
          type: query.type,
          search: query.search,
        },
        request.user
      );

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
    }
  );

  /**
   * GET /api/partner/projects/:id
   * Partner gets single assigned project detail (redacted)
   */
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.authorize(['partner', 'admin'])] },
    async (request, reply) => {
      const paramCheck = projectIdParamSchema.safeParse(request.params);
      if (!paramCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
        });
      }

      try {
        const project = await projectService.getById(paramCheck.data.id, request.user);
        return reply.send({ success: true, data: project });
      } catch (err: any) {
        if (err instanceof ProjectError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        throw err;
      }
    }
  );

  /**
   * POST /api/partner/projects/:id/photos
   * Partner uploads workshop photo for assigned project
   */
  fastify.post(
    '/:id/photos',
    { preHandler: [fastify.authenticate, fastify.authorize(['partner', 'admin'])] },
    async (request, reply) => {
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

      // Check partner assignment
      if (request.user.role === 'partner') {
        const partnerId = await projectService.getPartnerIdForUser(request.user);
        const project = await projectService.getById(paramCheck.data.id, request.user);
        if ((project as any).partnerId !== partnerId) {
          return reply.status(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'You are not assigned to this project' },
          });
        }
      }

      try {
        const created = await projectPhotoService.uploadPhoto(
          paramCheck.data.id,
          {
            photoUrl: bodyCheck.data.photoUrl,
            caption: bodyCheck.data.caption,
            tag: bodyCheck.data.tag || 'workshop',
            visibleToCustomer: bodyCheck.data.visibleToCustomer ?? true,
          },
          request.user
        );
        return reply.status(201).send({ success: true, data: created });
      } catch (err: any) {
        if (err instanceof PhotoError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        throw err;
      }
    }
  );
};
