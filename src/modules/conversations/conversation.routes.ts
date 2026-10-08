import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  sendMessageSchema,
  createConversationSchema,
} from './conversation.schema.js';
import { conversationService, ConversationError } from './conversation.service.js';
import { StorageService } from '../../services/storage.service.js';
import { db } from '../../db/index.js';
import { documents } from '../../db/schema.js';

const storageService = new StorageService();

const attachmentPayloadSchema = z.object({
  content: z.string().optional().default(''),
  fileName: z.string().min(1, 'fileName is required'),
  fileData: z.string().min(1, 'fileData is required'),
  mimeType: z.string().optional().default('application/octet-stream'),
});

export const conversationRoutes: FastifyPluginAsync = async (fastify) => {
  const handleError = (err: any, reply: any) => {
    if (err instanceof ConversationError) {
      return reply.status(err.statusCode).send({
        success: false,
        error: {
          code: err.code,
          message: err.message,
        },
      });
    }
    fastify.log.error(err);
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: err.message || 'An unexpected error occurred',
      },
    });
  };

  /**
   * GET /api/conversations
   * List conversations accessible to caller (Admin, Partner, Customer)
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parseResult = listConversationsQuerySchema.safeParse(request.query);
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
        const user = request.user!;
        const role = request.effectiveRole || user.role;
        const profileId = request.effectiveProfileId || user.profileId;

        const list = await conversationService.listConversations(
          user.sub,
          role,
          profileId,
          parseResult.data
        );

        return reply.status(200).send({
          success: true,
          data: list,
        });
      } catch (err: any) {
        return handleError(err, reply);
      }
    }
  );

  /**
   * GET /api/conversations/unread-count
   * Fast total unread badge count for caller
   */
  fastify.get(
    '/unread-count',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const user = request.user!;
        const result = await conversationService.getUnreadCount(user.sub);
        return reply.status(200).send({
          success: true,
          data: result,
        });
      } catch (err: any) {
        return handleError(err, reply);
      }
    }
  );

  /**
   * GET /api/conversations/project/:projectId
   * Get or provision project conversations (Customer Channel & Partner Channel)
   * Enforces 2-channel separation: Customer never sees partner channel; Partner never sees customer channel.
   */
  fastify.get(
    '/project/:projectId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      try {
        const user = request.user!;
        const role = request.effectiveRole || user.role;
        const profileId = request.effectiveProfileId || user.profileId;

        const channels = await conversationService.getOrProvisionProjectConversations(
          projectId,
          user.sub,
          role,
          profileId
        );

        return reply.status(200).send({
          success: true,
          data: channels,
        });
      } catch (err: any) {
        return handleError(err, reply);
      }
    }
  );

  /**
   * GET /api/conversations/:id
   * Get single conversation details
   */
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const user = request.user!;
        const role = request.effectiveRole || user.role;
        const profileId = request.effectiveProfileId || user.profileId;

        const conv = await conversationService.getConversationById(
          id,
          user.sub,
          role,
          profileId
        );

        return reply.status(200).send({
          success: true,
          data: conv,
        });
      } catch (err: any) {
        return handleError(err, reply);
      }
    }
  );

  /**
   * POST /api/conversations
   * Create a conversation thread manually (Admin only)
   */
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const parseResult = createConversationSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid conversation payload',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const user = request.user!;
        const role = request.effectiveRole || user.role;

        const conv = await conversationService.createConversation(
          parseResult.data,
          user.sub,
          role
        );

        return reply.status(201).send({
          success: true,
          data: conv,
        });
      } catch (err: any) {
        return handleError(err, reply);
      }
    }
  );

  /**
   * GET /api/conversations/:id/messages
   * Get chronological message stream for a conversation
   */
  fastify.get(
    '/:id/messages',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parseResult = listMessagesQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid message query parameters',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const user = request.user!;
        const role = request.effectiveRole || user.role;

        const messages = await conversationService.listMessages(
          id,
          user.sub,
          role,
          parseResult.data
        );

        return reply.status(200).send({
          success: true,
          data: messages,
        });
      } catch (err: any) {
        return handleError(err, reply);
      }
    }
  );

  /**
   * POST /api/conversations/:id/messages
   * Send a message to a conversation
   */
  fastify.post(
    '/:id/messages',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parseResult = sendMessageSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid message payload',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const user = request.user!;
        const role = request.effectiveRole || user.role;

        const message = await conversationService.sendMessage(
          id,
          user.sub,
          role,
          parseResult.data
        );

        return reply.status(201).send({
          success: true,
          data: message,
        });
      } catch (err: any) {
        return handleError(err, reply);
      }
    }
  );

  /**
   * POST /api/conversations/:id/attachment
   * Upload an attachment and send message in one atomic step
   */
  fastify.post(
    '/:id/attachment',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parseResult = attachmentPayloadSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid attachment payload',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const user = request.user!;
        const role = request.effectiveRole || user.role;

        // Verify conversation access first
        const conv = await conversationService.getConversationById(id, user.sub, role);

        const { content, fileName, fileData, mimeType } = parseResult.data;

        // Save file to disk
        const saved = await storageService.saveBase64(
          'chat_attachments',
          fileName,
          fileData,
          mimeType
        );

        // Insert into documents table
        const docNumber = `DOC-${Date.now().toString().slice(-6)}`;
        const [doc] = await db
          .insert(documents)
          .values({
            documentNumber: docNumber,
            documentType: 'cad_blueprint',
            fileName: saved.fileName,
            fileUrl: saved.filePath,
            fileSizeBytes: saved.fileSizeBytes,
            mimeType: saved.mimeType,
            projectId: conv.projectId || null,
            uploadedByUserId: user.sub,
          })
          .returning();

        // Send message linked to document
        const message = await conversationService.sendMessage(id, user.sub, role, {
          content: content || `Bijlage: ${fileName}`,
          attachmentDocumentId: doc.id,
        });

        return reply.status(201).send({
          success: true,
          data: message,
        });
      } catch (err: any) {
        return handleError(err, reply);
      }
    }
  );

  /**
   * PATCH /api/conversations/:id/read
   * Mark conversation as read for the authenticated caller
   */
  fastify.patch(
    '/:id/read',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const user = request.user!;
        const role = request.effectiveRole || user.role;

        const result = await conversationService.markAsRead(id, user.sub, role);
        return reply.status(200).send({
          success: true,
          data: result,
        });
      } catch (err: any) {
        return handleError(err, reply);
      }
    }
  );
};
