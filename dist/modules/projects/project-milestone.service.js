import { db } from '../../db/index.js';
import { projectMilestones, projects } from '../../db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
export class MilestoneError extends Error {
    statusCode;
    code;
    constructor(message, statusCode = 400, code = 'MILESTONE_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
    }
}
export class ProjectMilestoneService {
    /**
     * Check if a milestone is protected (billing/instalment-linked)
     */
    isBillingProtected(milestone) {
        const code = milestone.milestoneCode.toLowerCase();
        const title = milestone.title.toLowerCase();
        return (code.includes('aanbetaling') ||
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
            title.includes('20%'));
    }
    /**
     * Map milestone record to DTO
     */
    mapToDto(m) {
        return {
            id: m.id,
            projectId: m.projectId,
            milestoneCode: m.milestoneCode,
            title: m.title,
            description: m.description,
            sequenceOrder: m.sequenceOrder,
            status: m.status,
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
    async getMilestones(projectId, user) {
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
    async createMilestone(projectId, data, user) {
        const [project] = await db
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);
        if (!project) {
            throw new MilestoneError('Project not found', 404, 'PROJECT_NOT_FOUND');
        }
        const code = data.milestoneCode ||
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
            scheduledStartDate: data.scheduledStartDate ? data.scheduledStartDate : null,
            scheduledEndDate: data.scheduledEndDate ? data.scheduledEndDate : null,
            verifiedByUserId: user.sub,
        })
            .returning();
        return this.mapToDto(created);
    }
    /**
     * PATCH /api/projects/:id/milestones/:mId
     */
    async updateMilestone(projectId, milestoneId, data, user) {
        const [milestone] = await db
            .select()
            .from(projectMilestones)
            .where(and(eq(projectMilestones.id, milestoneId), eq(projectMilestones.projectId, projectId)))
            .limit(1);
        if (!milestone) {
            throw new MilestoneError('Milestone not found', 404, 'NOT_FOUND');
        }
        const updateValues = {
            updatedAt: new Date(),
        };
        if (data.title !== undefined)
            updateValues.title = data.title;
        if (data.description !== undefined)
            updateValues.description = data.description;
        if (data.sequenceOrder !== undefined)
            updateValues.sequenceOrder = data.sequenceOrder;
        if (data.status !== undefined) {
            updateValues.status = data.status;
            if (data.status === 'completed' && !milestone.completedAt) {
                updateValues.completedAt = new Date();
            }
            else if (data.status !== 'completed') {
                updateValues.completedAt = null;
            }
        }
        if (data.scheduledStartDate !== undefined)
            updateValues.scheduledStartDate = data.scheduledStartDate ? data.scheduledStartDate : null;
        if (data.scheduledEndDate !== undefined)
            updateValues.scheduledEndDate = data.scheduledEndDate ? data.scheduledEndDate : null;
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
    async deleteMilestone(projectId, milestoneId, user) {
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
            throw new MilestoneError('Billing-linked milestone is protected and cannot be deleted because it is tied to invoice instalment schedules.', 400, 'CANNOT_DELETE_BILLING_MILESTONE');
        }
        await db.delete(projectMilestones).where(eq(projectMilestones.id, milestoneId));
        return { success: true };
    }
}
export const projectMilestoneService = new ProjectMilestoneService();
