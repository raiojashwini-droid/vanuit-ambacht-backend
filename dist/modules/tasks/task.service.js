import { eq, or, ilike, sql, desc, asc, and, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../db/index.js';
import { tasks, users, leads, projects } from '../../db/schema.js';
export class TaskError extends Error {
    statusCode;
    code;
    constructor(message, statusCode = 400, code = 'TASK_ERROR') {
        super(message);
        this.name = 'TaskError';
        this.statusCode = statusCode;
        this.code = code;
    }
}
// Aliases for users table
const assigneeUser = alias(users, 'assignee_user');
const creatorUser = alias(users, 'creator_user');
export class TaskService {
    /**
     * Generates a unique sequential task number in format TSK-YYYY-XXX
     */
    async generateTaskNumber(tx) {
        const client = tx || db;
        const year = new Date().getFullYear();
        const prefix = `TSK-${year}-`;
        const [latest] = await client
            .select({ taskNumber: tasks.taskNumber })
            .from(tasks)
            .where(ilike(tasks.taskNumber, `${prefix}%`))
            .orderBy(desc(tasks.taskNumber))
            .limit(1);
        if (!latest) {
            return `${prefix}001`;
        }
        const currentNumber = parseInt(latest.taskNumber.replace(prefix, ''), 10);
        const nextSeq = isNaN(currentNumber) ? 1 : currentNumber + 1;
        return `${prefix}${nextSeq.toString().padStart(3, '0')}`;
    }
    /**
     * Helper to format a joined row into a clean TaskDto
     */
    mapRowToDto(row) {
        const t = row.task;
        const a = row.assignee;
        const c = row.creator;
        const l = row.lead;
        const p = row.project;
        let linkedType = 'None';
        let linkedItem = null;
        if (t.projectId && p) {
            linkedType = 'Project';
            linkedItem = {
                type: 'Project',
                id: p.id,
                name: p.name,
                number: p.projectNumber,
            };
        }
        else if (t.leadId && l) {
            linkedType = 'Lead';
            linkedItem = {
                type: 'Lead',
                id: l.id,
                name: l.name,
                number: l.leadNumber,
            };
        }
        const isCompleted = t.status === 'completed';
        return {
            id: t.id,
            taskNumber: t.taskNumber,
            title: t.title,
            description: t.description,
            leadId: t.leadId,
            projectId: t.projectId,
            linkedType,
            linkedItem,
            assignedToUserId: t.assignedToUserId,
            assignee: a ? {
                id: a.id,
                fullName: a.fullName,
                email: a.email,
                role: a.role,
            } : null,
            createdByUserId: t.createdByUserId,
            creator: c ? {
                id: c.id,
                fullName: c.fullName,
                email: c.email,
            } : null,
            priority: t.priority,
            status: t.status,
            completed: isCompleted,
            dueDate: typeof t.dueDate === 'string' ? t.dueDate : new Date(t.dueDate).toISOString().split('T')[0],
            completedAt: t.completedAt ? new Date(t.completedAt).toISOString() : null,
            createdAt: new Date(t.createdAt).toISOString(),
            updatedAt: new Date(t.updatedAt).toISOString(),
        };
    }
    /**
     * List tasks with filtering, search, scoping, and pagination
     */
    async listTasks(filter, currentUserId, role, partnerId) {
        const conditions = [];
        // Role Scoping:
        // Partners only see tasks assigned to them OR linked to their assigned projects
        if (role === 'partner') {
            if (partnerId) {
                conditions.push(or(eq(tasks.assignedToUserId, currentUserId), and(sql `${tasks.projectId} IS NOT NULL`, eq(projects.partnerId, partnerId))));
            }
            else {
                conditions.push(eq(tasks.assignedToUserId, currentUserId));
            }
        }
        // Status filter
        if (filter.status && filter.status !== 'all') {
            if (filter.status === 'pending') {
                conditions.push(inArray(tasks.status, ['pending', 'in_progress']));
            }
            else {
                conditions.push(eq(tasks.status, filter.status));
            }
        }
        // Priority filter
        if (filter.priority) {
            conditions.push(eq(tasks.priority, filter.priority));
        }
        // Assignee filter
        if (filter.assigneeId) {
            conditions.push(eq(tasks.assignedToUserId, filter.assigneeId));
        }
        // Lead filter
        if (filter.leadId) {
            conditions.push(eq(tasks.leadId, filter.leadId));
        }
        // Project filter
        if (filter.projectId) {
            conditions.push(eq(tasks.projectId, filter.projectId));
        }
        // Due date range
        if (filter.dueDateFrom) {
            conditions.push(sql `${tasks.dueDate} >= ${filter.dueDateFrom}`);
        }
        if (filter.dueDateTo) {
            conditions.push(sql `${tasks.dueDate} <= ${filter.dueDateTo}`);
        }
        // Search query across title, taskNumber, lead name, project name
        if (filter.search && filter.search.trim()) {
            const q = `%${filter.search.trim()}%`;
            conditions.push(or(ilike(tasks.title, q), ilike(tasks.taskNumber, q), ilike(leads.name, q), ilike(projects.name, q)));
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        // Total Count
        const [countResult] = await db
            .select({ count: sql `count(distinct ${tasks.id})` })
            .from(tasks)
            .leftJoin(leads, eq(tasks.leadId, leads.id))
            .leftJoin(projects, eq(tasks.projectId, projects.id))
            .where(whereClause);
        const total = Number(countResult?.count || 0);
        const page = Math.max(1, filter.page || 1);
        const limit = Math.min(100, Math.max(1, filter.limit || 50));
        const offset = (page - 1) * limit;
        const totalPages = Math.ceil(total / limit) || 1;
        // Data query
        const rows = await db
            .select({
            task: tasks,
            assignee: assigneeUser,
            creator: creatorUser,
            lead: leads,
            project: projects,
        })
            .from(tasks)
            .leftJoin(assigneeUser, eq(tasks.assignedToUserId, assigneeUser.id))
            .leftJoin(creatorUser, eq(tasks.createdByUserId, creatorUser.id))
            .leftJoin(leads, eq(tasks.leadId, leads.id))
            .leftJoin(projects, eq(tasks.projectId, projects.id))
            .where(whereClause)
            .orderBy(asc(tasks.status), asc(tasks.dueDate), desc(tasks.createdAt))
            .limit(limit)
            .offset(offset);
        const taskDtos = rows.map((r) => this.mapRowToDto(r));
        return {
            tasks: taskDtos,
            pagination: {
                page,
                limit,
                total,
                totalPages,
            },
        };
    }
    /**
     * Fast summary count of tasks (All, Pending, Completed, Overdue)
     */
    async getTaskSummary(currentUserId, role, partnerId) {
        const scopingConditions = [];
        if (role === 'partner') {
            if (partnerId) {
                scopingConditions.push(or(eq(tasks.assignedToUserId, currentUserId), and(sql `${tasks.projectId} IS NOT NULL`, eq(projects.partnerId, partnerId))));
            }
            else {
                scopingConditions.push(eq(tasks.assignedToUserId, currentUserId));
            }
        }
        const whereClause = scopingConditions.length > 0 ? and(...scopingConditions) : undefined;
        const [stats] = await db
            .select({
            all: sql `count(distinct ${tasks.id})`,
            pending: sql `count(distinct ${tasks.id}) filter (where ${tasks.status} in ('pending', 'in_progress'))`,
            completed: sql `count(distinct ${tasks.id}) filter (where ${tasks.status} = 'completed')`,
            overdue: sql `count(distinct ${tasks.id}) filter (where ${tasks.status} != 'completed' and ${tasks.dueDate} < current_date)`,
        })
            .from(tasks)
            .leftJoin(projects, eq(tasks.projectId, projects.id))
            .where(whereClause);
        return {
            all: Number(stats?.all || 0),
            pending: Number(stats?.pending || 0),
            completed: Number(stats?.completed || 0),
            overdue: Number(stats?.overdue || 0),
        };
    }
    /**
     * Get single task by ID or taskNumber
     */
    async getTaskById(id, currentUserId, role, partnerId) {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        const [row] = await db
            .select({
            task: tasks,
            assignee: assigneeUser,
            creator: creatorUser,
            lead: leads,
            project: projects,
        })
            .from(tasks)
            .leftJoin(assigneeUser, eq(tasks.assignedToUserId, assigneeUser.id))
            .leftJoin(creatorUser, eq(tasks.createdByUserId, creatorUser.id))
            .leftJoin(leads, eq(tasks.leadId, leads.id))
            .leftJoin(projects, eq(tasks.projectId, projects.id))
            .where(isUuid ? eq(tasks.id, id) : eq(tasks.taskNumber, id))
            .limit(1);
        if (!row) {
            throw new TaskError('Task not found', 404, 'TASK_NOT_FOUND');
        }
        // Role check for partner
        if (role === 'partner') {
            const isAssigned = row.task.assignedToUserId === currentUserId;
            const isProjectPartner = partnerId && row.project?.partnerId === partnerId;
            if (!isAssigned && !isProjectPartner) {
                throw new TaskError('Access denied for this task', 403, 'FORBIDDEN');
            }
        }
        return this.mapRowToDto(row);
    }
    /**
     * Create a new task
     */
    async createTask(data, createdByUserId, role, partnerId) {
        // 1. Validate Lead if provided
        if (data.leadId) {
            const [leadRow] = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, data.leadId)).limit(1);
            if (!leadRow) {
                throw new TaskError('Linked lead does not exist', 404, 'LEAD_NOT_FOUND');
            }
        }
        // 2. Validate Project if provided
        if (data.projectId) {
            const [projRow] = await db.select({ id: projects.id, partnerId: projects.partnerId }).from(projects).where(eq(projects.id, data.projectId)).limit(1);
            if (!projRow) {
                throw new TaskError('Linked project does not exist', 404, 'PROJECT_NOT_FOUND');
            }
            if (role === 'partner' && partnerId && projRow.partnerId !== partnerId) {
                throw new TaskError('Cannot create task for an unassigned project', 403, 'FORBIDDEN');
            }
        }
        // 3. Resolve & validate assignee
        let assigneeId = data.assignedToUserId;
        if (!assigneeId) {
            assigneeId = createdByUserId;
        }
        else {
            const [userRow] = await db
                .select({ id: users.id, isActive: users.isActive })
                .from(users)
                .where(eq(users.id, assigneeId))
                .limit(1);
            if (!userRow) {
                throw new TaskError('Assigned user not found', 404, 'USER_NOT_FOUND');
            }
            if (!userRow.isActive) {
                throw new TaskError('Cannot assign task to an inactive user', 400, 'USER_INACTIVE');
            }
        }
        // 4. Generate Task Number
        const taskNumber = await this.generateTaskNumber();
        // 5. Determine leadId & projectId based on linkedType
        let targetLeadId = data.leadId || null;
        let targetProjectId = data.projectId || null;
        if (data.linkedType === 'None') {
            targetLeadId = null;
            targetProjectId = null;
        }
        else if (data.linkedType === 'Lead') {
            targetProjectId = null;
        }
        else if (data.linkedType === 'Project') {
            targetLeadId = null;
        }
        // 6. Insert
        const [inserted] = await db
            .insert(tasks)
            .values({
            taskNumber,
            title: data.title.trim(),
            description: data.description || null,
            leadId: targetLeadId,
            projectId: targetProjectId,
            assignedToUserId: assigneeId,
            createdByUserId,
            priority: (data.priority || 'medium'),
            status: 'pending',
            dueDate: data.dueDate,
            completedAt: null,
        })
            .returning();
        return this.getTaskById(inserted.id, createdByUserId, role, partnerId);
    }
    /**
     * Update task details
     */
    async updateTask(id, data, currentUserId, role, partnerId) {
        const existing = await this.getTaskById(id, currentUserId, role, partnerId);
        // Partner permissions: can only update tasks created by or assigned to self
        if (role === 'partner') {
            if (existing.assignedToUserId !== currentUserId && existing.createdByUserId !== currentUserId) {
                throw new TaskError('Partners can only edit tasks assigned to or created by them', 403, 'FORBIDDEN');
            }
        }
        const updates = {
            updatedAt: new Date(),
        };
        if (data.title !== undefined) {
            updates.title = data.title.trim();
        }
        if (data.description !== undefined) {
            updates.description = data.description;
        }
        if (data.priority !== undefined) {
            updates.priority = data.priority;
        }
        if (data.dueDate !== undefined) {
            updates.dueDate = data.dueDate;
        }
        if (data.linkedType !== undefined) {
            if (data.linkedType === 'None') {
                updates.leadId = null;
                updates.projectId = null;
            }
            else if (data.linkedType === 'Lead') {
                if (data.leadId !== undefined)
                    updates.leadId = data.leadId;
                updates.projectId = null;
            }
            else if (data.linkedType === 'Project') {
                if (data.projectId !== undefined)
                    updates.projectId = data.projectId;
                updates.leadId = null;
            }
        }
        else {
            if (data.leadId !== undefined)
                updates.leadId = data.leadId;
            if (data.projectId !== undefined)
                updates.projectId = data.projectId;
        }
        // Validate new leadId if changed
        if (updates.leadId) {
            const [leadRow] = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, updates.leadId)).limit(1);
            if (!leadRow)
                throw new TaskError('Linked lead does not exist', 404, 'LEAD_NOT_FOUND');
        }
        // Validate new projectId if changed
        if (updates.projectId) {
            const [projRow] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, updates.projectId)).limit(1);
            if (!projRow)
                throw new TaskError('Linked project does not exist', 404, 'PROJECT_NOT_FOUND');
        }
        // Reassignment via update (Admin only)
        if (data.assignedToUserId !== undefined && data.assignedToUserId !== existing.assignedToUserId) {
            if (role !== 'admin') {
                throw new TaskError('Only administrators can reassign tasks', 403, 'FORBIDDEN');
            }
            const [userRow] = await db
                .select({ id: users.id, isActive: users.isActive })
                .from(users)
                .where(eq(users.id, data.assignedToUserId))
                .limit(1);
            if (!userRow || !userRow.isActive) {
                throw new TaskError('Assigned user does not exist or is inactive', 400, 'USER_INVALID');
            }
            updates.assignedToUserId = data.assignedToUserId;
        }
        await db.update(tasks).set(updates).where(eq(tasks.id, existing.id));
        return this.getTaskById(existing.id, currentUserId, role, partnerId);
    }
    /**
     * Toggle or update task status (Pending, In Progress, Completed, Cancelled)
     */
    async updateTaskStatus(id, statusOrCompleted, currentUserId, role, partnerId) {
        const existing = await this.getTaskById(id, currentUserId, role, partnerId);
        let nextStatus;
        if (statusOrCompleted.completed !== undefined) {
            nextStatus = statusOrCompleted.completed ? 'completed' : 'pending';
        }
        else if (statusOrCompleted.status !== undefined) {
            nextStatus = statusOrCompleted.status;
        }
        else {
            throw new TaskError('Either status or completed must be provided', 400, 'STATUS_REQUIRED');
        }
        const completedAt = nextStatus === 'completed' ? new Date() : null;
        await db
            .update(tasks)
            .set({
            status: nextStatus,
            completedAt,
            updatedAt: new Date(),
        })
            .where(eq(tasks.id, existing.id));
        return this.getTaskById(existing.id, currentUserId, role, partnerId);
    }
    /**
     * Reassign task to a different user (Admin only)
     */
    async reassignTask(id, newAssigneeUserId, currentUserId, role) {
        if (role !== 'admin') {
            throw new TaskError('Only administrators can reassign tasks', 403, 'FORBIDDEN');
        }
        const existing = await this.getTaskById(id, currentUserId, role);
        const [userRow] = await db
            .select({ id: users.id, isActive: users.isActive })
            .from(users)
            .where(eq(users.id, newAssigneeUserId))
            .limit(1);
        if (!userRow) {
            throw new TaskError('New assignee user not found', 404, 'USER_NOT_FOUND');
        }
        if (!userRow.isActive) {
            throw new TaskError('Cannot reassign task to an inactive user', 400, 'USER_INACTIVE');
        }
        await db
            .update(tasks)
            .set({
            assignedToUserId: newAssigneeUserId,
            updatedAt: new Date(),
        })
            .where(eq(tasks.id, existing.id));
        return this.getTaskById(existing.id, currentUserId, role);
    }
    /**
     * Batch create tasks (for Plaud AI meeting action item imports)
     */
    async batchCreateTasks(tasksData, createdByUserId, role) {
        if (role !== 'admin') {
            throw new TaskError('Only administrators can batch import tasks', 403, 'FORBIDDEN');
        }
        if (!Array.isArray(tasksData) || tasksData.length === 0) {
            throw new TaskError('Task list cannot be empty', 400, 'EMPTY_BATCH');
        }
        const createdIds = [];
        await db.transaction(async (tx) => {
            for (const item of tasksData) {
                const taskNumber = await this.generateTaskNumber(tx);
                const assigneeId = item.assignedToUserId || createdByUserId;
                let targetLeadId = item.leadId || null;
                let targetProjectId = item.projectId || null;
                if (item.linkedType === 'None') {
                    targetLeadId = null;
                    targetProjectId = null;
                }
                else if (item.linkedType === 'Lead') {
                    targetProjectId = null;
                }
                else if (item.linkedType === 'Project') {
                    targetLeadId = null;
                }
                const [row] = await tx
                    .insert(tasks)
                    .values({
                    taskNumber,
                    title: item.title.trim(),
                    description: item.description || null,
                    leadId: targetLeadId,
                    projectId: targetProjectId,
                    assignedToUserId: assigneeId,
                    createdByUserId,
                    priority: (item.priority || 'medium'),
                    status: 'pending',
                    dueDate: item.dueDate,
                })
                    .returning();
                createdIds.push(row.id);
            }
        });
        const resultList = [];
        for (const taskId of createdIds) {
            const dto = await this.getTaskById(taskId, createdByUserId, role);
            resultList.push(dto);
        }
        return resultList;
    }
    /**
     * Delete task
     */
    async deleteTask(id, currentUserId, role) {
        if (role !== 'admin') {
            throw new TaskError('Only administrators can delete tasks', 403, 'FORBIDDEN');
        }
        const existing = await this.getTaskById(id, currentUserId, role);
        await db.delete(tasks).where(eq(tasks.id, existing.id));
    }
}
export const taskService = new TaskService();
