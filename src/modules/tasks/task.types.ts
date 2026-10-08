export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type LinkedType = 'Project' | 'Lead' | 'None';

export interface TaskAssigneeDto {
  id: string;
  fullName: string;
  email: string;
  role: string;
}

export interface TaskCreatorDto {
  id: string;
  fullName: string;
  email: string;
}

export interface TaskLinkedItemDto {
  type: LinkedType;
  id: string;
  name: string;
  number?: string;
}

export interface TaskDto {
  id: string;
  taskNumber: string;
  title: string;
  description: string | null;
  leadId: string | null;
  projectId: string | null;
  linkedType: LinkedType;
  linkedItem: TaskLinkedItemDto | null;
  assignedToUserId: string;
  assignee: TaskAssigneeDto | null;
  createdByUserId: string;
  creator: TaskCreatorDto | null;
  priority: TaskPriority;
  status: TaskStatus;
  completed: boolean;
  dueDate: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  linkedType?: LinkedType;
  projectId?: string | null;
  leadId?: string | null;
  assignedToUserId?: string;
  priority?: TaskPriority;
  dueDate: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  linkedType?: LinkedType;
  projectId?: string | null;
  leadId?: string | null;
  assignedToUserId?: string;
  priority?: TaskPriority;
  dueDate?: string;
}

export interface UpdateTaskStatusInput {
  status?: TaskStatus;
  completed?: boolean;
}

export interface ReassignTaskInput {
  assignedToUserId: string;
}

export interface ListTasksFilter {
  status?: TaskStatus | 'all';
  priority?: TaskPriority;
  assigneeId?: string;
  leadId?: string;
  projectId?: string;
  search?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
  page?: number;
  limit?: number;
}

export interface TaskSummaryDto {
  all: number;
  pending: number;
  completed: number;
  overdue: number;
}

export interface PaginatedTasksDto {
  tasks: TaskDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
