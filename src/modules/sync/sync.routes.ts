import { FastifyPluginAsync } from 'fastify';
import { syncService } from './sync.service.js';

export const syncRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/sync/status
   * Fast, lightweight endpoint for multi-user real-time state synchronization
   * Returns current system sync version and entity-level timestamps
   */
  fastify.get('/status', {
    preHandler: [fastify.authenticate],
  }, async (_request, reply) => {
    return reply.send({
      success: true,
      data: syncService.getStatus(),
    });
  });
};
