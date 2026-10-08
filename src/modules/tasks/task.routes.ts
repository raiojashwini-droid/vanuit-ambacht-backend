import type { FastifyPluginAsync } from 'fastify';
import {
  listTasksQuerySchema,
  createTaskSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
  reassignTaskSchema,
  batchCreateTasksSchema,
} from './task.schema.js';
import { taskService, TaskError } from './task.service.js';

export const taskRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Helper to handle service errors
   */
  const handleError = (err: any, reply: any) => {
    if (err instanceof TaskError) {
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
   * GET /api/tasks
   * Lists tasks with search, filters, and pagination
   * Admin + Partner
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] },
    async (request, reply) => {
      const parseResult = listTasksQuerySchema.safeParse(request.query);
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
        const partnerId = request.effectiveProfileId || user.profileId;

        const result = await taskService.listTasks(parseResult.data, user.sub, role, partnerId);
        return reply.status(200).send({
          success: true,
          data: result.tasks,
          pagination: result.pagination,
        });
      } catch (err: any) {
        return handleError(err, reply);
      }
    }
  );

  /**
   * GET /api/tasks/summary
   * Returns fast KPI counts (All, Pending, Completed, Overdue)
   * Admin + Partner
   */
  fastify.get(
    '/summary',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] },
    async (request, reply) => {
      try {
        const user = request.user!;
        const role = request.effectiveRole || user.role;
        const partnerId = request.effectiveProfileId || user.profileId;

        const summary = await taskService.getTaskSummary(user.sub, role, partnerId);
        return reply.status(200).send({
          success: true,
          data: summary,
        });
      } catch (err: any) {
        return handleError(err, reply);
      }
    }
  );

  /**
   * GET /api/tasks/:id
   * Get single task by ID or taskNumber
   * Admin + Partner
   */
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const user = request.user!;
        const role = request.effectiveRole || user.role;
        const partnerId = request.effectiveProfileId || user.profileId;

        const task = await taskService.getTaskById(id, user.sub, role, partnerId);
        return reply.status(200).send({
          success: true,
          data: task,
        });
      } catch (err: any) {
        return handleError(err, reply);
      }
    }
  );

  /**
   * POST /api/tasks
   * Create a new task
   * Admin + Partner
   */
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] },
    async (request, reply) => {
      const parseResult = createTaskSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Validation failed for new task',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const user = request.user!;
        const role = request.effectiveRole || user.role;
        const partnerId = request.effectiveProfileId || user.profileId;

        const task = await taskService.createTask(parseResult.data as any, user.sub, role, partnerId);
        return reply.status(201).send({
          success: true,
          data: task,
        });
      } catch (err: any) {
        return handleError(err, reply);
      }
    }
  );

  /**
   * PATCH /api/tasks/:id
   * Update task details
   * Admin + Partner (for assigned/created)
   */
  fastify.patch(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parseResult = updateTaskSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid task update payload',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const user = request.user!;
        const role = request.effectiveRole || user.role;
        const partnerId = request.effectiveProfileId || user.profileId;

        const updated = await taskService.updateTask(id, parseResult.data as any, user.sub, role, partnerId);
        return reply.status(200).send({
          success: true,
          data: updated,
        });
      } catch (err: any) {
        return handleError(err, reply);
      }
    }
  );

  /**
   * PATCH /api/tasks/:id/status
   * Toggle or update task status
   * Admin + Partner
   */
  fastify.patch(
    '/:id/status',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parseResult = updateTaskStatusSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid status payload. Provide "status" or "completed".',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const user = request.user!;
        const role = request.effectiveRole || user.role;
        const partnerId = request.effectiveProfileId || user.profileId;

        const updated = await taskService.updateTaskStatus(id, parseResult.data as any, user.sub, role, partnerId);
        return reply.status(200).send({
          success: true,
          data: updated,
        });
      } catch (err: any) {
        return handleError(err, reply);
      }
    }
  );

  /**
   * PATCH /api/tasks/:id/assign
   * Dedicated endpoint to reassign a task
   * Admin only
   */
  fastify.patch(
    '/:id/assign',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parseResult = reassignTaskSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid reassign payload. Must include assignedToUserId.',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const user = request.user!;
        const role = request.effectiveRole || user.role;

        const updated = await taskService.reassignTask(id, parseResult.data.assignedToUserId, user.sub, role);
        return reply.status(200).send({
          success: true,
          data: updated,
        });
      } catch (err: any) {
        return handleError(err, reply);
      }
    }
  );

  /**
   * POST /api/tasks/batch
   * Batch create tasks (for Plaud AI meeting action item imports)
   * Admin only
   */
  fastify.post(
    '/batch',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const parseResult = batchCreateTasksSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid batch task payload',
            details: parseResult.error.format(),
          },
        });
      }

      try {
        const user = request.user!;
        const role = request.effectiveRole || user.role;

        const createdTasks = await taskService.batchCreateTasks(parseResult.data.tasks as any, user.sub, role);
        return reply.status(201).send({
          success: true,
          data: createdTasks,
          count: createdTasks.length,
        });
      } catch (err: any) {
        return handleError(err, reply);
      }
    }
  );

  /**
   * DELETE /api/tasks/:id
   * Delete task
   * Admin only
   */
  fastify.delete(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const user = request.user!;
        const role = request.effectiveRole || user.role;

        await taskService.deleteTask(id, user.sub, role);
        return reply.status(200).send({
          success: true,
          message: 'Task deleted successfully',
        });
      } catch (err: any) {
        return handleError(err, reply);
      }
    }
  );
};
