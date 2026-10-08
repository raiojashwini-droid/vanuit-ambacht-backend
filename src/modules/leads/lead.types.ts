import type { productTypeEnum, leadStatusEnum } from '../../db/schema.js';

export type ProductType = (typeof productTypeEnum.enumValues)[number];
export type LeadStatus = (typeof leadStatusEnum.enumValues)[number];

export interface LeadListItem {
  id: string;
  leadNumber: string;
  customerId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  productType: ProductType;
  dimensionsInquiry: string | null;
  source: string | null;
  status: LeadStatus;
  workflowStep: number;
  assignedToUserId: string;
  assignedToName?: string;
  lostReason: string | null;
  notes?: string | null;
  intakeNotes?: string | null;
  createdAt: string;
  updatedAt: string;
  voiceNotesCount?: number;
  commercialActionsCount?: number;
}

export interface VoiceNoteDto {
  id: string;
  leadId: string;
  uploadedByUserId: string;
  uploadedByName?: string;
  fileName: string;
  fileUrl: string;
  durationSeconds: number | null;
  recordingDate: string;
  transcriptText: string | null;
  aiSummary: string | null;
  extractedSpecs: any;
  createdAt: string;
}

export interface CommercialActionDto {
  id: string;
  leadId: string | null;
  projectId: string | null;
  createdByUserId: string;
  createdByName?: string;
  actionType: string;
  note: string;
  actionDate: string;
  linkedTaskId: string | null;
  linkedTask?: {
    id: string;
    taskNumber: string;
    title: string;
    status: string;
    priority: string;
    dueDate: string;
    assignedToName?: string;
  } | null;
  createdAt: string;
}

export interface LeadDossier extends LeadListItem {
  voiceNotes: VoiceNoteDto[];
  commercialActions: CommercialActionDto[];
  customer?: {
    id: string;
    customerNumber: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    city: string;
  } | null;
}

export interface LeadQueryParams {
  search?: string;
  status?: string;
  workflowStep?: number;
  productType?: ProductType;
  assignedToUserId?: string;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'name' | 'workflowStep' | 'status';
  sortOrder?: 'asc' | 'desc';
}
