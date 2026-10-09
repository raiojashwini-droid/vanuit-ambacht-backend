export type PartnerWorkloadStatus = 'available' | 'busy' | 'fully_booked' | 'inactive';

export interface PartnerListItem {
  id: string;
  partnerCode: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  kvkNumber: string | null;
  btwNumber: string | null;
  region: string | null;
  workloadStatus: PartnerWorkloadStatus;
  availableWeeks?: number[] | null;
  rating: string;
  specialties: string[] | null;
  productTypes: string[] | null;
  isActive: boolean;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  activeBuildsCount?: number;
}

export interface PartnerDossier extends PartnerListItem {
  projects: Array<{
    id: string;
    projectNumber: string;
    name: string;
    projectType: string;
    status: string;
    progressPercentage: number;
    agreedBuildPrice: string | null;
    createdAt: string;
  }>;
  submittedOffers: Array<{
    id: string;
    requestId: string;
    revisionNumber: number;
    costPrice: string;
    laborHours: string | null;
    status: string;
    createdAt: string;
  }>;
  metrics: {
    activeBuildsCount: number;
    completedBuildsCount: number;
    totalSubmittedOffersCount: number;
    acceptedOffersCount: number;
    currentRating: string;
    workload: PartnerWorkloadStatus;
  };
}

export interface PartnerQueryFilters {
  search?: string;
  workloadStatus?: PartnerWorkloadStatus;
  productType?: string;
  region?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'companyName' | 'rating' | 'workloadStatus';
  sortOrder?: 'asc' | 'desc';
}
