/**
 * Module 4: Quotations & Calculations — TypeScript Type Definitions
 */

export type QuoteStatus = 'draft' | 'sent' | 'approved' | 'declined' | 'expired';
export type QuoteVersionStatus = 'draft' | 'sent' | 'approved' | 'superseded';

export interface QuoteItemDto {
  id?: string;
  position: number;
  title: string;
  description?: string | null;
  quantity: number;
  unitPriceInclVat: number;
  vatRate: number;
  lineTotalInclVat: number;
  isIncluded: boolean;
  isStelpost: boolean;
}

export interface InstalmentDto {
  step: number;
  percentage: number;
  label: string;
  amount: number;
}

export interface InstalmentsConfig {
  count: number;
  percentages: number[];
  labels: string[];
  subtexts?: string[];
}

export interface DiagramSegment {
  id: string;
  type: string;
  label: string;
  width: number;
}

export interface DiagramConfig {
  show: boolean;
  totalWidth: number;
  segments: DiagramSegment[];
}

export interface SpecificationLine {
  id: string;
  text: string;
  isOption: boolean;
}

export interface SpecificationSection {
  id: string;
  title: string;
  lines: SpecificationLine[];
}

export interface UspCard {
  id: number;
  title: string;
  desc: string;
}

export interface ProcessStep {
  step: string;
  title: string;
  desc: string;
  badge?: string;
}

export interface LetterConfig {
  salutation: string;
  letterParagraphs: string[];
  signoffName: string;
  signoffRole: string;
  uspCards?: UspCard[];
  processSteps?: ProcessStep[];
  approvalTitle?: string;
  approvalSubheading?: string;
  approvalText?: string;
  closingQuote?: string;
  closingAuthor?: string;
}

export interface DigitalSignatureDto {
  signerName: string;
  signerIp?: string;
  userAgent?: string;
  agreedTerms: boolean;
  signatureSvg?: string | null;
  approvedAt: string;
}

export interface QuoteVersionDto {
  id: string;
  quoteId: string;
  versionNumber: number;
  isCurrent: boolean;
  createdByUserId: string;
  coverTitleLine1?: string | null;
  coverTitleLine2?: string | null;
  customSubtitle?: string | null;
  coverPhotos?: string[] | null;
  dimensionsText?: string | null;
  woodType?: string | null;
  woodLifespan?: string | null;
  optionsTitle?: string | null;
  optionsSubtext?: string | null;
  deliveryTimeText?: string | null;
  deliverySubtext?: string | null;
  costPrice?: number | null;
  marginPercent?: number | null;
  marginAmount?: number | null;
  subtotalExclVat: number;
  vatAmount: number;
  totalInclVat: number;
  finishTreatment?: string | null;
  stelpostDisclaimer?: string | null;
  vatDisclaimer?: string | null;
  validityText?: string | null;
  instalmentsConfig?: InstalmentsConfig | null;
  diagramConfig?: DiagramConfig | null;
  specificationsOverview?: SpecificationSection[] | null;
  letterConfig?: LetterConfig | null;
  status: QuoteVersionStatus;
  digitalSignature?: DigitalSignatureDto | null;
  approvedAt?: string | null;
  createdAt: string;
  items?: QuoteItemDto[];
}

/**
 * Full Quote DTO for Admin and authenticated operations
 */
export interface QuoteDto {
  id: string;
  quoteNumber: string;
  publicToken: string;
  publicUrl: string;
  leadId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerCity?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  acceptedPartnerOfferId?: string | null;
  status: QuoteStatus;
  productType: string;
  issueDate: string;
  validUntil: string;
  sentAt?: string | null;
  isExpired: boolean;
  createdAt: string;
  updatedAt: string;
  activeVersion?: QuoteVersionDto | null;
  versions?: QuoteVersionDto[];
}

/**
 * Public Sanitized Offerte DTO (Strict Privacy: NO Partner details, NO cost price, NO margin %, NO margin amount, NO internal notes)
 */
export interface PublicOfferteDto {
  quoteNumber: string;
  publicToken: string;
  customerName: string;
  customerCity: string;
  customerAddress?: string;
  productType: string;
  issueDate: string;
  validUntil: string;
  status: QuoteStatus;
  isExpired: boolean;
  cover: {
    titleLine1: string;
    titleLine2: string;
    customSubtitle?: string | null;
    photos: string[];
  };
  configuration: {
    dimensions: string;
    woodType: string;
    woodLifespan: string;
    optionsTitle: string;
    optionsSubtext: string;
    deliveryTime: string;
    deliverySubtext: string;
    specifications: SpecificationSection[];
    diagram?: DiagramConfig | null;
  };
  investment: {
    lineItems: Array<{
      title: string;
      description?: string | null;
      quantity: number;
      priceInclVat: number;
      vatRate: number;
      lineTotalInclVat: number;
      isIncluded: boolean;
      isStelpost: boolean;
    }>;
    subtotalExclVat: number;
    vatAmount: number;
    totalInclVat: number;
    finishTreatment?: string | null;
    stelpostDisclaimer?: string | null;
    vatDisclaimer?: string | null;
    validityNote?: string | null;
    instalments: InstalmentDto[];
  };
  letterAndProcess: LetterConfig;
  company: {
    name: string;
    address: string;
    kvk: string;
    vat: string;
    iban: string;
    email: string;
    phone: string;
  };
  digitalSignature?: {
    signerName: string;
    approvedAt: string;
  } | null;
}

export interface QuoteListResponse {
  items: QuoteDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counters: {
    total: number;
    draft: number;
    sent: number;
    approved: number;
    declined: number;
  };
}
