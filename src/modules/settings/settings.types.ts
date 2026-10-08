export interface CompanySettingsDto {
  id: string;
  companyName: string;
  website: string | null;
  kvkNumber: string | null;
  btwNumber: string | null;
  iban: string | null;
  bankName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  standardVatRate: number;
  lowVatRate: number;
  quotePrefix: string;
  invoicePrefix: string;
  defaultMarginPercentage: number;
  quoteTermsText: string | null;
  fiscalLockDate: string | null;
  brandingColors: any;
  categoriesConfig: any;
  fieldsetsConfig: any;
  partnerBreakdownConfig: any;
  plConfig: any;
  messageTemplates: any;
  quoteTemplateConfig: any;
  integrationsConfig: any;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCompanySettingsDto {
  companyName?: string;
  website?: string | null;
  kvkNumber?: string | null;
  btwNumber?: string | null;
  iban?: string | null;
  bankName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string;
  standardVatRate?: number;
  lowVatRate?: number;
  quotePrefix?: string;
  invoicePrefix?: string;
  defaultMarginPercentage?: number;
  quoteTermsText?: string | null;
  fiscalLockDate?: string | null;
  brandingColors?: any;
  categoriesConfig?: any;
  fieldsetsConfig?: any;
  partnerBreakdownConfig?: any;
  plConfig?: any;
  messageTemplates?: any;
  quoteTemplateConfig?: any;
  integrationsConfig?: any;
}

export type SettingsConfigSection =
  | 'branding'
  | 'categories'
  | 'fieldsets'
  | 'partner-breakdown'
  | 'pl-targets'
  | 'templates'
  | 'quote-template'
  | 'integrations';

export interface SystemUserDto {
  id: string;
  fullName: string;
  email: string;
  role: 'admin' | 'partner' | 'customer';
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSystemUserDto {
  fullName: string;
  email: string;
  role: 'admin' | 'partner' | 'customer';
  password: string;
  phone?: string | null;
}
