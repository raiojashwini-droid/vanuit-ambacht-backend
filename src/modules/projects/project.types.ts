import type { JwtTokenPayload } from '../../types/auth.types.js';

export type ProjectType = 'outdoor_kitchen' | 'garden_room';
export type ProjectStatus = 'pending' | 'in_progress' | 'completed' | 'on_hold' | 'cancelled';
export type MilestoneStatus = 'pending' | 'in_progress' | 'completed';

export interface StatusTexts {
  watErNuGebeurt?: string;
  watErHiernaKomt?: string;
  leverweek?: string;
  leverStatus?: string;
  internalNotes?: string;
}

export interface CustomerAction {
  id: string;
  title: string;
  subtitle?: string;
  actionType: 'proposal' | 'checklist' | 'confirmation' | 'document';
  dueDate?: string;
  completed: boolean;
  completedAt?: string | null;
}

export interface DeliverySlotData {
  proposedDate?: string;
  timeWindow?: string;
  proposedTimeSlot?: string;
  notes?: string;
  status: 'pending' | 'tentative' | 'confirmed';
  confirmedAt?: string | null;
  confirmedBy?: string | null;
}

export interface SchouwData {
  schouwDate?: string;
  inspectorName?: string;
  accessDetails?: string;
  foundationCheck?: boolean;
  notes?: string;
  completed?: boolean;
  status?: string;
  surveyDate?: string;
  timeSlot?: string;
  confirmedAt?: string;
  confirmedBy?: string;
}

export interface WeekPlanningItem {
  id: string;
  weekNumber: number;
  phase: string;
  status: 'pending' | 'in_progress' | 'completed';
  notes?: string;
}

export interface RenderFeedbackItem {
  id: string;
  comment: string;
  createdAt: string;
  customerName?: string;
}

export interface RenderVersion {
  id: string;
  versionNumber: number;
  title: string;
  woodColor?: string;
  notes?: string;
  isLive: boolean;
  createdAt: string;
  images: string[];
  feedback?: RenderFeedbackItem[];
}

export interface OpleveringData {
  checklist: Record<string, boolean>;
  signeeName: string;
  signatureDataUrl?: string;
  completedAt: string;
  documentId?: string;
  pdfUrl?: string;
  notes?: string;
}

export interface TechnicalSpecsData {
  statusTexts?: StatusTexts;
  customerActions?: CustomerAction[];
  schouw?: SchouwData;
  weekPlanning?: WeekPlanningItem[];
  renderVersions?: RenderVersion[];
  oplevering?: OpleveringData;
  dimensions?: string;
  woodType?: string;
  materials?: any[];
  productionStep?: number;
  [key: string]: any;
}

export interface ProjectMilestoneDto {
  id: string;
  projectId: string;
  milestoneCode: string;
  title: string;
  description: string | null;
  sequenceOrder: number;
  status: MilestoneStatus;
  scheduledStartDate: string | null;
  scheduledEndDate: string | null;
  completedAt: string | null;
  isBillingLinked?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPhotoDto {
  id: string;
  projectId: string;
  uploadedByUserId: string;
  photoUrl: string;
  title?: string | null;
  phase?: string | null;
  craftsman?: string | null;
  caption: string | null;
  tag: string | null;
  visibleToCustomer: boolean;
  projectName?: string | null;
  customer?: string | null;
  createdAt: string;
}

export interface ProjectDocumentDto {
  id: string;
  documentNumber: string;
  documentType: string;
  fileName: string;
  fileUrl: string;
  fileSizeBytes: number | null;
  mimeType: string | null;
  isPublicForCustomer: boolean;
  isPublicForPartner: boolean;
  createdAt: string;
}

export interface ProjectDto {
  id: string;
  projectNumber: string;
  quoteId: string | null;
  quoteVersionId: string | null;
  customerId: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  partnerId: string | null;
  partnerName?: string | null;
  projectType: ProjectType;
  name: string;
  status: ProjectStatus;
  orderStatus: string | null;
  productionStep: number;
  agreedBuildPrice: number | null;
  contractValue: number | null;
  progressPercentage: number;
  deliveryAddress: string;
  postalCode: string | null;
  city: string;
  deliverySlot: DeliverySlotData | null;
  statusTexts: StatusTexts;
  customerActions: CustomerAction[];
  schouw: SchouwData | null;
  customerChecklist?: Record<string, boolean>;
  technicalSpecs?: any;
  weekPlanning: WeekPlanningItem[];
  renderVersions: RenderVersion[];
  oplevering: OpleveringData | null;
  milestones?: ProjectMilestoneDto[];
  photos?: ProjectPhotoDto[];
  documents?: ProjectDocumentDto[];
  invoicesCount?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Partner view of a project (strict financial redaction)
 */
export interface PartnerProjectDto {
  id: string;
  projectNumber: string;
  partnerId: string;
  partnerName?: string | null;
  projectType: ProjectType;
  name: string;
  status: ProjectStatus;
  orderStatus: string | null;
  productionStep: number;
  agreedBuildPrice: number | null; // Partners MAY see their agreed build fee
  // contractValue, profit margin, cost price, and internal admin notes are strictly omitted!
  progressPercentage: number;
  deliveryAddress: string;
  postalCode: string | null;
  city: string;
  customerName?: string | null;
  deliverySlot: DeliverySlotData | null;
  schouw: SchouwData | null;
  weekPlanning: WeekPlanningItem[];
  renderVersions: RenderVersion[];
  milestones?: ProjectMilestoneDto[];
  photos?: ProjectPhotoDto[];
  documents?: ProjectDocumentDto[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Customer view of their own project (sanitized)
 */
export interface CustomerProjectDto {
  id: string;
  projectNumber: string;
  projectType: ProjectType;
  name: string;
  status: ProjectStatus;
  orderStatus: string | null;
  productionStep: number;
  progressPercentage: number;
  deliveryAddress: string;
  postalCode: string | null;
  city: string;
  deliverySlot: DeliverySlotData | null;
  statusTexts: StatusTexts; // Without internalNotes
  customerActions: CustomerAction[];
  schouw?: { schouwDate?: string; completed?: boolean } | null;
  technicalSpecs?: any;
  customerChecklist?: Record<string, boolean>;
  renderVersions: RenderVersion[];
  milestones?: ProjectMilestoneDto[];
  photos?: ProjectPhotoDto[]; // Only where visibleToCustomer = true
  documents?: ProjectDocumentDto[]; // Only where isPublicForCustomer = true
  createdAt: string;
  updatedAt: string;
}
