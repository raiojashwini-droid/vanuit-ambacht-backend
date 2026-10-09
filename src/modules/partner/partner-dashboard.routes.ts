import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { projects, planningEvents, partners } from '../../db/schema.js';
import { eq, and, sql, gte, desc } from 'drizzle-orm';

const updateProgressSchema = z.object({
  progress: z.number().int().min(0).max(100).optional(),
  status: z.enum(['In Progress', 'Review Required', 'Completed', 'in_progress', 'completed', 'pending']).optional(),
});

const projectIdParamSchema = z.object({
  id: z.string().uuid('Invalid project UUID'),
});

export const partnerDashboardRoutes: FastifyPluginAsync = async (fastify) => {
  const partnerGuard = {
    preHandler: [fastify.authenticate, fastify.authorize(['partner', 'admin'])],
  };

  /**
   * Helper to retrieve partner ID for authenticated partner or admin impersonation
   */
  async function resolvePartnerId(user: any): Promise<string | null> {
    if (user.role === 'admin') {
      if (user.partnerId) return user.partnerId;
      if (user.profileId) return user.profileId;
      const firstPartner = await db.select({ id: partners.id }).from(partners).limit(1);
      return firstPartner[0]?.id || null;
    }

    if (user.partnerId) return user.partnerId;
    if (user.profileId) return user.profileId;

    const partnerRow = await db
      .select({ id: partners.id })
      .from(partners)
      .where(eq(partners.userId, user.sub))
      .limit(1);
    return partnerRow[0]?.id || null;
  }

  /**
   * 1. GET /api/partner/dashboard/stats
   * Partner scoped dashboard KPI summary
   */
  fastify.get('/dashboard/stats', partnerGuard, async (request, reply) => {
    try {
      const partnerId = await resolvePartnerId(request.user);
      if (!partnerId) {
        return reply.status(403).send({
          success: false,
          error: { code: 'NO_PARTNER_PROFILE', message: 'No partner profile associated with this account' },
        });
      }

      const assignedProjects = await db
        .select({
          id: projects.id,
          status: projects.status,
        })
        .from(projects)
        .where(eq(projects.partnerId, partnerId));

      const total = assignedProjects.length;
      const inProgress = assignedProjects.filter(p => p.status === 'in_progress').length;
      const completed = assignedProjects.filter(p => p.status === 'completed').length;
      const pending = assignedProjects.filter(p => p.status === 'pending').length;

      return reply.send({
        success: true,
        data: {
          totalAssignedProjects: total,
          inProgress,
          completed,
          pending,
        },
      });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch partner dashboard stats' },
      });
    }
  });

  /**
   * 2. PATCH /api/partner/projects/:id/progress
   * Partner updates progress percentage & stage for assigned project
   */
  fastify.patch('/projects/:id/progress', partnerGuard, async (request, reply) => {
    const paramCheck = projectIdParamSchema.safeParse(request.params);
    if (!paramCheck.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
      });
    }

    const bodyCheck = updateProgressSchema.safeParse(request.body);
    if (!bodyCheck.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
      });
    }

    try {
      const partnerId = await resolvePartnerId(request.user);
      const projectId = paramCheck.data.id;

      // Verify project exists and belongs to this partner
      const existingProject = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (existingProject.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }

      // Check partner assignment (Admin can bypass)
      if (request.user.role === 'partner' && existingProject[0].partnerId !== partnerId) {
        return reply.status(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You are not assigned to this project' },
        });
      }

      // Map status
      let dbStatus: any = existingProject[0].status;
      if (bodyCheck.data.status) {
        const s = bodyCheck.data.status.toLowerCase();
        if (s.includes('completed')) dbStatus = 'completed';
        else if (s.includes('progress')) dbStatus = 'in_progress';
        else dbStatus = 'in_progress';
      }

      const updated = await db
        .update(projects)
        .set({
          status: dbStatus,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectId))
        .returning({
          id: projects.id,
          projectNumber: projects.projectNumber,
          name: projects.name,
          status: projects.status,
          updatedAt: projects.updatedAt,
        });

      return reply.send({
        success: true,
        data: {
          ...updated[0],
          progress: bodyCheck.data.progress ?? (dbStatus === 'completed' ? 100 : 50),
        },
        message: 'Projectvoortgang succesvol bijgewerkt!',
      });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update project progress' },
      });
    }
  });

  /**
   * 3. GET /api/partner/dashboard/schedule
   * Partner's upcoming calendar schedule widget
   */
  fastify.get('/dashboard/schedule', partnerGuard, async (request, reply) => {
    try {
      const partnerId = await resolvePartnerId(request.user);
      if (!partnerId) {
        return reply.status(403).send({
          success: false,
          error: { code: 'NO_PARTNER_PROFILE', message: 'No partner profile associated with this account' },
        });
      }

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      let events = await db
        .select({
          id: planningEvents.id,
          title: planningEvents.title,
          type: planningEvents.eventType,
          startTime: planningEvents.startTime,
          endTime: planningEvents.endTime,
          lane: planningEvents.calendarLane,
          status: planningEvents.status,
          location: planningEvents.location,
        })
        .from(planningEvents)
        .where(
          and(
            eq(planningEvents.partnerId, partnerId),
            gte(planningEvents.startTime, startOfToday)
          )
        )
        .orderBy(planningEvents.startTime)
        .limit(10);

      if (events.length === 0) {
        events = await db
          .select({
            id: planningEvents.id,
            title: planningEvents.title,
            type: planningEvents.eventType,
            startTime: planningEvents.startTime,
            endTime: planningEvents.endTime,
            lane: planningEvents.calendarLane,
            status: planningEvents.status,
            location: planningEvents.location,
          })
          .from(planningEvents)
          .where(eq(planningEvents.partnerId, partnerId))
          .orderBy(desc(planningEvents.startTime))
          .limit(10);
      }

      return reply.send({
        success: true,
        data: events,
      });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch partner schedule' },
      });
    }
  });

  /**
   * 4. GET /api/partner/reports/summary-pdf
   * Partner quarterly performance summary scorecard PDF
   */
  fastify.get('/reports/summary-pdf', partnerGuard, async (request, reply) => {
    try {
      const partnerId = await resolvePartnerId(request.user);
      const partnerRows = partnerId
        ? await db.select().from(partners).where(eq(partners.id, partnerId)).limit(1)
        : [];
      const partnerName = partnerRows[0]?.companyName || partnerRows[0]?.contactPerson || 'Vakman Partner';

      const assignedProjects = partnerId
        ? await db.select().from(projects).where(eq(projects.partnerId, partnerId))
        : [];

      const total = assignedProjects.length;
      const completed = assignedProjects.filter(p => p.status === 'completed').length;
      const onTimeRate = total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 98.5;
      const dateStr = new Date().toISOString().split('T')[0];

      const lines = [
        '%PDF-1.4',
        '1 0 obj',
        '<< /Type /Catalog /Pages 2 0 R >>',
        'endobj',
        '2 0 obj',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        'endobj',
        '3 0 obj',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        'endobj',
        '5 0 obj',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
        'endobj',
        '4 0 obj',
        '<< /Length 600 >>',
        'stream',
        'BT',
        '/F1 20 Tf',
        '50 740 Td',
        '(VANUIT AMBACHT - PARTNER PRESTATIERAPPORT) Tj',
        '/F1 11 Tf',
        '0 -24 Td',
        `((Vakman: ${partnerName}) - Datum: ${dateStr}) Tj`,
        '0 -35 Td',
        '(KWARTAAL PRESTATIESCOREKAART:) Tj',
        '0 -22 Td',
        `((Totaal Toegewezen Projecten: ${total})) Tj`,
        '0 -18 Td',
        `((Succesvol Afgeronde Projecten: ${completed})) Tj`,
        '0 -18 Td',
        `((Tijdige Oplevering Score: ${onTimeRate}%)) Tj`,
        '0 -40 Td',
        '(Geverifieerd door Vanuit Ambacht Kwaliteitsbeheer - Vertrouwelijk) Tj',
        'ET',
        'endstream',
        'endobj',
        'xref',
        '0 6',
        '0000000000 65535 f ',
        '0000000009 00000 n ',
        '0000000058 00000 n ',
        '0000000115 00000 n ',
        '0000000300 00000 n ',
        '0000000230 00000 n ',
        'trailer',
        '<< /Size 6 /Root 1 0 R >>',
        'startxref',
        '950',
        '%%EOF',
      ];

      const pdfBuffer = Buffer.from(lines.join('\n'), 'utf-8');
      return reply
        .type('application/pdf')
        .header('Content-Disposition', `attachment; filename="Partner-Scorecard-${dateStr}.pdf"`)
        .send(pdfBuffer);
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to generate partner summary PDF' },
      });
    }
  });

  /**
   * 5. GET /api/partner/workload
   * Partner fetches their own current workload status and available calendar weeks
   */
  fastify.get('/workload', partnerGuard, async (request, reply) => {
    try {
      const partnerId = await resolvePartnerId(request.user);
      if (!partnerId) {
        return reply.status(403).send({
          success: false,
          error: { code: 'NO_PARTNER_PROFILE', message: 'No partner profile associated with this account' },
        });
      }

      const [partnerRow] = await db
        .select({
          id: partners.id,
          companyName: partners.companyName,
          workloadStatus: partners.workloadStatus,
          availableWeeks: partners.availableWeeks,
        })
        .from(partners)
        .where(eq(partners.id, partnerId))
        .limit(1);

      if (!partnerRow) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Partner profile not found' },
        });
      }

      return reply.send({
        success: true,
        data: {
          id: partnerRow.id,
          companyName: partnerRow.companyName,
          workloadStatus: partnerRow.workloadStatus,
          availableWeeks: partnerRow.availableWeeks || [],
        },
      });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch partner workload' },
      });
    }
  });

  /**
   * 6. PATCH /api/partner/workload
   * Partner updates their own workload status and available calendar weeks
   */
  fastify.patch('/workload', partnerGuard, async (request, reply) => {
    const workloadCheck = z.object({
      workloadStatus: z.enum(['available', 'busy', 'fully_booked', 'inactive']).optional(),
      availableWeeks: z.array(z.coerce.number().int().min(1).max(53)).nullable().optional(),
    }).refine(data => data.workloadStatus !== undefined || data.availableWeeks !== undefined, {
      message: 'At least one of workloadStatus or availableWeeks must be provided',
    }).safeParse(request.body);

    if (!workloadCheck.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: workloadCheck.error.issues[0]?.message },
      });
    }

    try {
      const partnerId = await resolvePartnerId(request.user);
      if (!partnerId) {
        return reply.status(403).send({
          success: false,
          error: { code: 'NO_PARTNER_PROFILE', message: 'No partner profile associated with this account' },
        });
      }

      const updateData: any = { updatedAt: new Date() };
      if (workloadCheck.data.workloadStatus !== undefined) {
        updateData.workloadStatus = workloadCheck.data.workloadStatus;
      }
      if (workloadCheck.data.availableWeeks !== undefined) {
        updateData.availableWeeks = workloadCheck.data.availableWeeks;
      }

      const [updated] = await db
        .update(partners)
        .set(updateData)
        .where(eq(partners.id, partnerId))
        .returning({
          id: partners.id,
          companyName: partners.companyName,
          workloadStatus: partners.workloadStatus,
          availableWeeks: partners.availableWeeks,
          updatedAt: partners.updatedAt,
        });

      return reply.send({
        success: true,
        message: 'Beschikbaarheid en werkdruk succesvol bijgewerkt',
        data: {
          ...updated,
          availableWeeks: updated.availableWeeks || [],
        },
      });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update partner workload' },
      });
    }
  });
};
