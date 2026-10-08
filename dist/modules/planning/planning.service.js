import { db } from '../../db/index.js';
import { planningEvents, projects, partners } from '../../db/schema.js';
import { eq, and, desc, sql, asc } from 'drizzle-orm';
export class PlanningService {
    async generateEventNumber(tx = db) {
        const year = new Date().getFullYear();
        const prefix = `EVT-${year}-`;
        const [latest] = await tx
            .select({ eventNumber: planningEvents.eventNumber })
            .from(planningEvents)
            .where(sql `${planningEvents.eventNumber} LIKE ${prefix + '%'}`)
            .orderBy(desc(planningEvents.eventNumber))
            .limit(1);
        let nextSeq = 1;
        if (latest?.eventNumber) {
            const parts = latest.eventNumber.split('-');
            const seq = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(seq))
                nextSeq = seq + 1;
        }
        return `${prefix}${String(nextSeq).padStart(3, '0')}`;
    }
    async getEvents(filter) {
        const conditions = [];
        if (filter.calendarLane)
            conditions.push(eq(planningEvents.calendarLane, filter.calendarLane));
        if (filter.partnerId)
            conditions.push(eq(planningEvents.partnerId, filter.partnerId));
        if (filter.projectId)
            conditions.push(eq(planningEvents.projectId, filter.projectId));
        if (filter.status)
            conditions.push(eq(planningEvents.status, filter.status));
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        return await db
            .select({
            event: planningEvents,
            project: projects,
            partner: partners,
        })
            .from(planningEvents)
            .leftJoin(projects, eq(planningEvents.projectId, projects.id))
            .leftJoin(partners, eq(planningEvents.partnerId, partners.id))
            .where(whereClause)
            .orderBy(asc(planningEvents.startTime));
    }
    async createEvent(data, user) {
        const eventNumber = await this.generateEventNumber();
        const [created] = await db
            .insert(planningEvents)
            .values({
            eventNumber,
            projectId: data.projectId || null,
            partnerId: data.partnerId || null,
            milestoneId: data.milestoneId || null,
            createdByUserId: user.sub,
            eventType: data.eventType,
            calendarLane: data.calendarLane,
            title: data.title,
            description: data.description,
            startTime: new Date(data.startTime),
            endTime: new Date(data.endTime),
            isAllDay: data.isAllDay ?? false,
            status: data.status || 'scheduled',
            location: data.location,
        })
            .returning();
        return created;
    }
    async updateEvent(id, data) {
        const [existing] = await db.select().from(planningEvents).where(eq(planningEvents.id, id)).limit(1);
        if (!existing) {
            throw new Error('Planning event not found');
        }
        const updateValues = {
            updatedAt: new Date(),
        };
        if (data.partnerId !== undefined)
            updateValues.partnerId = data.partnerId;
        if (data.eventType !== undefined)
            updateValues.eventType = data.eventType;
        if (data.calendarLane !== undefined)
            updateValues.calendarLane = data.calendarLane;
        if (data.title !== undefined)
            updateValues.title = data.title;
        if (data.description !== undefined)
            updateValues.description = data.description;
        if (data.startTime !== undefined)
            updateValues.startTime = new Date(data.startTime);
        if (data.endTime !== undefined)
            updateValues.endTime = new Date(data.endTime);
        if (data.isAllDay !== undefined)
            updateValues.isAllDay = data.isAllDay;
        if (data.status !== undefined)
            updateValues.status = data.status;
        if (data.location !== undefined)
            updateValues.location = data.location;
        const [updated] = await db.update(planningEvents).set(updateValues).where(eq(planningEvents.id, id)).returning();
        return updated;
    }
}
export const planningService = new PlanningService();
