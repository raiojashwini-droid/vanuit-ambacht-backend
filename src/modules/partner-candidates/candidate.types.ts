export type CandidateStage = 'interested' | 'in_discussion' | 'trial_project' | 'active' | 'rejected';

export interface CandidateDto {
  id: string;
  candidateNumber: string;
  name: string;
  companyName: string | null;
  email: string;
  phone: string;
  region: string | null;
  stage: CandidateStage;
  notes: string | null;
  specialties: string[] | null;
  productTypes: string[] | null;
  kvkNumber: string | null;
  btwNumber: string | null;
  convertedPartnerId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateListResponse {
  items: CandidateDto[];
  total: number;
  stageCounts: Record<CandidateStage, number>;
}
