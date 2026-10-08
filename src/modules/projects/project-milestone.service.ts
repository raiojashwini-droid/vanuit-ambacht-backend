import { db } from '../../db/index.js';
import { projectMilestones, projects, invoices } from '../../db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import type { ProjectMilestoneDto, MilestoneStatus } from './project.types.js';
import type { JwtTokenPayload } from '../../types/auth.types.js';

export class MilestoneError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 400, code = 'MILESTONE_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ProjectMilestoneService {
  /**
   * Check if a milestone is protected (billing/instalment-linked)
   */
  private isBillingProtected(milestone: typeof projectMilestones.$inferSelect): boolean {
    const code = milestone.milestoneCode.toLowerCase();
    const title = milestone.title.toLowerCase();
    return (
      code.includes('aanbetaling') ||
      code.includes('termijn') ||
      code.includes('slottermijn') ||
      code.includes('factuur') ||
      code.includes('invoice') ||
      code.includes('down_payment') ||
      title.includes('aanbetaling') ||
      title.includes('termijn') ||
      title.includes('slottermijn') ||
      title.includes('50%') ||
      title.includes('40%') ||
      title.includes('20%')
    );
  }

  /**
   * Map milestone record to DTO
   */
  mapToDto(m: typeof projectMilestones.$inferSelect): ProjectMilestoneDto {
    return {
      id: m.id,
      projectId: m.projectId,
      milestoneCode: m.milestoneCode,
      title: m.title,
      description: m.description,
      sequenceOrder: m.sequenceOrder,
      status: m.status as MilestoneStatus,
      scheduledStartDate: m.scheduledStartDate ? String(m.scheduledStartDate).split('T')[0] : null,
      scheduledEndDate: m.scheduledEndDate ? String(m.scheduledEndDate).split('T')[0] : null,
      completedAt: m.completedAt ? m.completedAt.toISOString() : null,
      isBillingLinked: this.isBillingProtected(m),
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  }

  /**
   * GET /api/projects/:id/milestones
   */
  async getMilestones(projectId: string, user: JwtTokenPayload): Promise<ProjectMilestoneDto[]> {
    const rows = await db
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, projectId))
      .orderBy(asc(projectMilestones.sequenceOrder), asc(projectMilestones.createdAt));

    return rows.map((r) => this.mapToDto(r));
  }

  /**
   * POST /api/projects/:id/milestones
   */
  async createMilestone(
    projectId: string,
    data: {
      title: string;
      milestoneCode?: string;
      description?: string;
      sequenceOrder?: number;
      status?: MilestoneStatus;
      scheduledStartDate?: string | null;
      scheduledEndDate?: string | null;
    },
    user: JwtTokenPayload
  ): Promise<ProjectMilestoneDto> {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      throw new MilestoneError('Project not found', 404, 'PROJECT_NOT_FOUND');
    }

    const code =
      data.milestoneCode ||
      `MS-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;

    const [created] = await db
      .insert(projectMilestones)
      .values({
        projectId,
        milestoneCode: code,
        title: data.title,
        description: data.description,
        sequenceOrder: data.sequenceOrder || 1,
        status: data.status || 'pending',
        scheduledStartDate: data.scheduledStartDate ? (data.scheduledStartDate as any) : null,
        scheduledEndDate: data.scheduledEndDate ? (data.scheduledEndDate as any) : null,
        verifiedByUserId: user.sub,
      })
      .returning();

    return this.mapToDto(created);
  }

  /**
   * PATCH /api/projects/:id/milestones/:mId
   */
  async updateMilestone(
    projectId: string,
    milestoneId: string,
    data: {
      title?: string;
      description?: string | null;
      sequenceOrder?: number;
      status?: MilestoneStatus;
      scheduledStartDate?: string | null;
      scheduledEndDate?: string | null;
      completedAt?: string | null;
    },
    user: JwtTokenPayload
  ): Promise<ProjectMilestoneDto> {
    const [milestone] = await db
      .select()
      .from(projectMilestones)
      .where(and(eq(projectMilestones.id, milestoneId), eq(projectMilestones.projectId, projectId)))
      .limit(1);

    if (!milestone) {
      throw new MilestoneError('Milestone not found', 404, 'NOT_FOUND');
    }

    const updateValues: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (data.title !== undefined) updateValues.title = data.title;
    if (data.description !== undefined) updateValues.description = data.description;
    if (data.sequenceOrder !== undefined) updateValues.sequenceOrder = data.sequenceOrder;
    if (data.status !== undefined) {
      updateValues.status = data.status;
      if (data.status === 'completed' && !milestone.completedAt) {
        updateValues.completedAt = new Date();
      } else if (data.status !== 'completed') {
        updateValues.completedAt = null;
      }
    }
    if (data.scheduledStartDate !== undefined) updateValues.scheduledStartDate = data.scheduledStartDate ? (data.scheduledStartDate as any) : null;
    if (data.scheduledEndDate !== undefined) updateValues.scheduledEndDate = data.scheduledEndDate ? (data.scheduledEndDate as any) : null;
    if (data.completedAt !== undefined) {
      updateValues.completedAt = data.completedAt ? new Date(data.completedAt) : null;
    }

    const [updated] = await db
      .update(projectMilestones)
      .set(updateValues)
      .where(eq(projectMilestones.id, milestoneId))
      .returning();

    return this.mapToDto(updated);
  }

  /**
   * DELETE /api/projects/:id/milestones/:mId
   * Billing-linked milestones must not be deleted!
   */
  async deleteMilestone(projectId: string, milestoneId: string, user: JwtTokenPayload): Promise<{ success: boolean }> {
    const [milestone] = await db
      .select()
      .from(projectMilestones)
      .where(and(eq(projectMilestones.id, milestoneId), eq(projectMilestones.projectId, projectId)))
      .limit(1);

    if (!milestone) {
      throw new MilestoneError('Milestone not found', 404, 'NOT_FOUND');
    }

    // Protection check
    if (this.isBillingProtected(milestone)) {
      throw new MilestoneError(
        'Billing-linked milestone is protected and cannot be deleted because it is tied to invoice instalment schedules.',
        400,
        'CANNOT_DELETE_BILLING_MILESTONE'
      );
    }

    await db.delete(projectMilestones).where(eq(projectMilestones.id, milestoneId));
    return { success: true };
  }
}

export const projectMilestoneService = new ProjectMilestoneService();
