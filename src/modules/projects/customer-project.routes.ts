import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { projectService, ProjectError } from './project.service.js';
import { projectPhotoService, PhotoError } from './project-photo.service.js';
import { documentService, DocumentError } from '../documents/document.service.js';
import { db } from '../../db/index.js';
import { quotes, quoteVersions, quoteItems, partners, conversations } from '../../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { renderFeedbackSchema, customerChecklistSchema } from './project.schema.js';

const projectIdParamSchema = z.object({
  id: z.string().uuid('Invalid project UUID'),
});

const checklistParamSchema = z.object({
  id: z.string().uuid('Invalid project UUID'),
  itemId: z.string().min(1, 'Item ID is required'),
});

export const customerProjectRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/customer/projects
   * Customer views list of own projects (sanitized DTO)
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate, fastify.authorize(['customer', 'admin'])] },
    async (request, reply) => {
      const result = await projectService.listProjects(
        { page: 1, limit: 10, sort: 'createdAt:desc' },
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
   * GET /api/customer/projects/:id
   * Customer views own project portal (sanitized)
   */
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.authorize(['customer', 'admin'])] },
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
   * POST /api/customer/projects/:id/delivery-slot/confirm
   * Customer 1-click confirmation of proposed delivery slot (Approved Decision #2)
   */
  fastify.post(
    '/:id/delivery-slot/confirm',
    { preHandler: [fastify.authenticate, fastify.authorize(['customer', 'admin'])] },
    async (request, reply) => {
      const paramCheck = projectIdParamSchema.safeParse(request.params);
      if (!paramCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
        });
      }

      try {
        const body = (request.body || {}) as any;
        const project = await projectService.confirmDeliverySlot(
          paramCheck.data.id,
          request.user,
          body.proposedDate,
          body.proposedTimeSlot
        );
        return reply.send({
          success: true,
          data: project,
          message: 'Bezorgmoment succesvol bevestigd!',
        });
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
   * POST /api/customer/projects/:id/schouw/confirm
   * Customer 1-click confirmation of site survey (schouw)
   */
  fastify.post(
    '/:id/schouw/confirm',
    { preHandler: [fastify.authenticate, fastify.authorize(['customer', 'admin'])] },
    async (request, reply) => {
      const paramCheck = projectIdParamSchema.safeParse(request.params);
      if (!paramCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
        });
      }

      try {
        const body = (request.body || {}) as any;
        const project = await projectService.confirmSchouw(
          paramCheck.data.id,
          request.user,
          body.surveyDate,
          body.timeSlot
        );
        return reply.send({
          success: true,
          data: project,
          message: 'Schouwmoment succesvol bevestigd!',
        });
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
   * POST /api/customer/projects/:id/render-feedback
   * Customer comments on 3D CAD render version
   */
  fastify.post(
    '/:id/render-feedback',
    { preHandler: [fastify.authenticate, fastify.authorize(['customer', 'admin'])] },
    async (request, reply) => {
      const paramCheck = projectIdParamSchema.safeParse(request.params);
      if (!paramCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
        });
      }

      const bodyCheck = renderFeedbackSchema.safeParse(request.body);
      if (!bodyCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
        });
      }

      try {
        const project = await projectService.addRenderFeedback(paramCheck.data.id, bodyCheck.data, request.user);
        return reply.send({
          success: true,
          data: project,
          message: 'Feedback op 3D render succesvol verzonden.',
        });
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
   * PATCH /api/customer/projects/:id/checklist/:itemId
   * Customer marks readiness checklist item completed
   */
  fastify.patch(
    '/:id/checklist/:itemId',
    { preHandler: [fastify.authenticate, fastify.authorize(['customer', 'admin'])] },
    async (request, reply) => {
      const paramCheck = checklistParamSchema.safeParse(request.params);
      if (!paramCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PARAMS', message: 'Invalid project or item ID' },
        });
      }

      const bodyCheck = customerChecklistSchema.safeParse(request.body);
      if (!bodyCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
        });
      }

      try {
        const project = await projectService.updateCustomerChecklist(
          paramCheck.data.id,
          paramCheck.data.itemId,
          bodyCheck.data.completed,
          request.user
        );
        return reply.send({
          success: true,
          data: project,
        });
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
   * GET /api/customer/projects/:id/documents
   * Customer retrieves their project documents dossier (only isPublicForCustomer = true)
   */
  fastify.get(
    '/:id/documents',
    { preHandler: [fastify.authenticate, fastify.authorize(['customer', 'admin'])] },
    async (request, reply) => {
      const paramCheck = projectIdParamSchema.safeParse(request.params);
      if (!paramCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid project UUID format' },
        });
      }

      try {
        const result = await documentService.getCustomerDocumentsForProject(
          paramCheck.data.id,
          request.user
        );
        return reply.send({ success: true, ...result });
      } catch (err: any) {
        if (err instanceof DocumentError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve customer documents' },
        });
      }
    }
  );

  /**
   * GET /api/customer/projects/:id/photos
   * Customer retrieves build & workshop photos (only visibleToCustomer = true)
   */
  fastify.get(
    '/:id/photos',
    { preHandler: [fastify.authenticate, fastify.authorize(['customer', 'admin'])] },
    async (request, reply) => {
      const paramCheck = projectIdParamSchema.safeParse(request.params);
      if (!paramCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid project UUID format' },
        });
      }

      try {
        const result = await projectPhotoService.getCustomerPhotosForProject(
          paramCheck.data.id,
          request.user
        );
        return reply.send({ success: true, ...result });
      } catch (err: any) {
        if (err instanceof PhotoError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve customer photos' },
        });
      }
    }
  );

  /**
   * GET /api/customer/projects/:id/quotes
   * Customer views quote proposals & payment terms for their project (sanitized, zero internal cost/margin)
   */
  fastify.get(
    '/:id/quotes',
    { preHandler: [fastify.authenticate, fastify.authorize(['customer', 'admin'])] },
    async (request, reply) => {
      const paramCheck = projectIdParamSchema.safeParse(request.params);
      if (!paramCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid project UUID format' },
        });
      }

      try {
        // Enforce customer ownership check
        const project = await projectService.getById(paramCheck.data.id, request.user);

        // Fetch quotes linked to project (via project.quoteId or quotes list)
        const quoteId = (project as any).quoteId;
        const projectQuotes = quoteId
          ? await db.select().from(quotes).where(eq(quotes.id, quoteId))
          : await db.select().from(quotes).limit(1);

        // For each quote, fetch approved / latest version details
        const quotesWithDetails = await Promise.all(
          projectQuotes.map(async (q) => {
            const versions = await db
              .select({
                id: quoteVersions.id,
                versionNumber: quoteVersions.versionNumber,
                status: quoteVersions.status,
                subtotalExclVat: quoteVersions.subtotalExclVat,
                vatAmount: quoteVersions.vatAmount,
                totalInclVat: quoteVersions.totalInclVat,
                instalmentsConfig: quoteVersions.instalmentsConfig,
                specificationsOverview: quoteVersions.specificationsOverview,
                createdAt: quoteVersions.createdAt,
              })
              .from(quoteVersions)
              .where(eq(quoteVersions.quoteId, q.id))
              .orderBy(desc(quoteVersions.versionNumber));

            const latestVersion = versions[0];
            let items: any[] = [];
            if (latestVersion) {
              items = await db
                .select({
                  id: quoteItems.id,
                  position: quoteItems.position,
                  title: quoteItems.title,
                  description: quoteItems.description,
                  quantity: quoteItems.quantity,
                  unitPriceInclVat: quoteItems.unitPriceInclVat,
                  lineTotalInclVat: quoteItems.lineTotalInclVat,
                })
                .from(quoteItems)
                .where(eq(quoteItems.quoteVersionId, latestVersion.id));
            }

            return {
              id: q.id,
              quoteNumber: q.quoteNumber,
              status: q.status,
              createdAt: q.createdAt,
              updatedAt: q.updatedAt,
              versions,
              currentVersion: latestVersion ? { ...latestVersion, items } : null,
            };
          })
        );

        return reply.send({
          success: true,
          data: quotesWithDetails,
          projectType: (project as any).type,
        });
      } catch (err: any) {
        if (err instanceof ProjectError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve customer quotes' },
        });
      }
    }
  );

  /**
   * GET /api/customer/projects/:id/contact
   * Customer retrieves project team contacts, assigned partner, and chat channel ID
   */
  fastify.get(
    '/:id/contact',
    { preHandler: [fastify.authenticate, fastify.authorize(['customer', 'admin'])] },
    async (request, reply) => {
      const paramCheck = projectIdParamSchema.safeParse(request.params);
      if (!paramCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid project UUID format' },
        });
      }

      try {
        // Enforce customer ownership check
        const project = await projectService.getById(paramCheck.data.id, request.user);

        // Fetch assigned partner if present
        let partnerContact = null;
        if ((project as any).partnerId) {
          const partnerRows = await db
            .select({
              id: partners.id,
              companyName: partners.companyName,
              contactPerson: partners.contactPerson,
              phone: partners.phone,
              email: partners.email,
            })
            .from(partners)
            .where(eq(partners.id, (project as any).partnerId))
            .limit(1);

          partnerContact = partnerRows[0] || null;
        }

        // Fetch active conversation for this project
        const convRows = await db
          .select({
            id: conversations.id,
            conversationNumber: conversations.conversationNumber,
            title: conversations.title,
          })
          .from(conversations)
          .where(eq(conversations.projectId, paramCheck.data.id))
          .limit(1);

        return reply.send({
          success: true,
          data: {
            projectId: (project as any).id,
            projectName: (project as any).name,
            projectType: (project as any).type,
            company: {
              name: 'Vanuit Ambacht B.V.',
              email: 'info@vanuitambacht.nl',
              phone: '+31 6 98765432',
              address: 'Ambachtsweg 12, 5061 JX Oisterwijk',
            },
            partner: partnerContact,
            conversationId: convRows[0]?.id || null,
          },
        });
      } catch (err: any) {
        if (err instanceof ProjectError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        fastify.log.error(err);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve project contact channels' },
        });
      }
    }
  );
};

