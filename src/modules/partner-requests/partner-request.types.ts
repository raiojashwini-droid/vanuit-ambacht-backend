/**
 * Module 3: Partner Price Requests & Offers — TypeScript Type Definitions
 */

export type PprStatus = 'requested' | 'offers_received' | 'selected' | 'declined' | 'cancelled';
export type PartnerOfferStatus = 'submitted' | 'under_review' | 'accepted' | 'rejected' | 'superseded';

export interface BreakdownItem {
  sectionTitle: string;
  label: string;
  amount: number;
}

export interface OfferBreakdown {
  transportCost?: number | null;
  installationCost?: number | null;
  otherCost?: number | null;
  items?: BreakdownItem[];
}

export interface RequestDimensions {
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  rawText?: string | null;
}

export interface RequestMaterials {
  woodType?: string | null;
  countertop?: string | null;
  appliances?: string[] | null;
  notes?: string | null;
  rawText?: string | null;
}

export interface RequestLocationAccess {
  city?: string | null;
  siteAccess?: string | null;
  gardenAccessNotes?: string | null;
}

export interface PartnerRequestAttachmentDto {
  id: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSizeBytes: number;
  category?: string | null;
  createdAt: string;
}

export interface PartnerOfferDto {
  id: string;
  offerNumber: string;
  requestId: string;
  partnerId: string;
  partnerName?: string;
  revisionNumber: number;
  costPrice: number;
  laborHours?: number | null;
  materialsCost?: number | null;
  laborCost?: number | null;
  estimatedLeadTimeWeeks?: number | null;
  partnerNotes?: string | null;
  breakdown?: OfferBreakdown | null;
  status: PartnerOfferStatus;
  submittedAt: string;
  createdAt: string;
}

/**
 * Sanitized response for Craftsmen (Strict Privacy Policy: NO customer name, email, phone, street address, or budget)
 */
export interface PartnerPriceRequestDto {
  id: string;
  requestNumber: string;
  leadId: string;
  partnerId: string;
  partnerName?: string;
  category?: string | null;
  productInfo?: string | null;
  dimensions?: RequestDimensions | null;
  materials?: RequestMaterials | null;
  locationAccess?: RequestLocationAccess | null;
  requestedAt: string;
  expectedResponseDate: string;
  status: PprStatus;
  createdAt: string;
  updatedAt: string;

  // Confidential fields — ONLY visible to Admin, strictly undefined for Partner
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  customerBudget?: number | null;
  internalLockedCost?: number | null;
  targetMarginPercent?: number | null;
  calculatedSellPrice?: number | null;

  attachments?: PartnerRequestAttachmentDto[];
  offers?: PartnerOfferDto[];
  activeOffer?: PartnerOfferDto | null;
}

export interface PartnerRequestListResponse {
  items: PartnerPriceRequestDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
