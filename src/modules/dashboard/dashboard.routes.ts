import { FastifyPluginAsync } from 'fastify';
import { dashboardService } from './dashboard.service.js';
import {
  dateRangeQuerySchema,
  activityQuerySchema,
  revenueTrendsQuerySchema,
} from './dashboard.schema.js';

export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  // All dashboard routes are restricted to Admin role only
  const adminGuard = { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] };

  /**
   * 1. GET /api/dashboard/kpis
   * 7 Top KPI cards with trend comparisons
   */
  fastify.get('/kpis', adminGuard, async (request, reply) => {
    try {
      const filter = dateRangeQuerySchema.parse(request.query);
      const kpis = await dashboardService.getKpis(filter);
      return reply.send({ success: true, data: kpis });
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ success: false, error: err.errors });
      }
      throw err;
    }
  });

  /**
   * 2. GET /api/dashboard/financials
   * Financial Snapshot (Revenue this month, outstanding invoices, expected revenue)
   */
  fastify.get('/financials', adminGuard, async (request, reply) => {
    try {
      const financials = await dashboardService.getFinancialSnapshot();
      return reply.send({ success: true, data: financials });
    } catch (err: any) {
      throw err;
    }
  });

  /**
   * 3. GET /api/dashboard/funnel
   * 4-Stage Conversion Funnel
   */
  fastify.get('/funnel', adminGuard, async (request, reply) => {
    try {
      const filter = dateRangeQuerySchema.parse(request.query);
      const funnel = await dashboardService.getConversionFunnel(filter);
      return reply.send({ success: true, data: funnel });
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ success: false, error: err.errors });
      }
      throw err;
    }
  });

  /**
   * 4. GET /api/dashboard/today
   * Today & This Week bundle (follow-ups, deliveries, open tasks)
   */
  fastify.get('/today', adminGuard, async (request, reply) => {
    try {
      const todayBundle = await dashboardService.getTodayBundle();
      return reply.send({ success: true, data: todayBundle });
    } catch (err: any) {
      throw err;
    }
  });

  /**
   * 5. GET /api/dashboard/warnings
   * Operational warnings and action required alerts
   */
  fastify.get('/warnings', adminGuard, async (request, reply) => {
    try {
      const warnings = await dashboardService.getWarnings();
      return reply.send({ success: true, data: warnings });
    } catch (err: any) {
      throw err;
    }
  });

  /**
   * 6. GET /api/dashboard/activity
   * Live consolidated activity feed
   */
  fastify.get('/activity', adminGuard, async (request, reply) => {
    try {
      const query = activityQuerySchema.parse(request.query);
      const activities = await dashboardService.getActivityFeed(query.limit);
      return reply.send({ success: true, data: activities });
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ success: false, error: err.errors });
      }
      throw err;
    }
  });

  /**
   * 7. GET /api/dashboard/reports/revenue-trends
   * Monthly revenue performance breakdown (Jan–Dec)
   */
  fastify.get('/reports/revenue-trends', adminGuard, async (request, reply) => {
    try {
      const query = revenueTrendsQuerySchema.parse(request.query);
      const trends = await dashboardService.getRevenueTrends(query.year);
      return reply.send({ success: true, data: trends });
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ success: false, error: err.errors });
      }
      throw err;
    }
  });
};
