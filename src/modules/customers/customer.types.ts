export interface CustomerListItem {
  id: string;
  customerNumber: string;
  companyName: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  streetAddress: string | null;
  postalCode: string | null;
  city: string;
  country: string;
  notes: string | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  activeProjectsCount?: number;
  lifetimeSpend?: string;
}

export interface CustomerDossier extends CustomerListItem {
  projects: Array<{
    id: string;
    projectNumber: string;
    name: string;
    projectType: string;
    status: string;
    progressPercentage: number;
    contractValue: string | null;
    createdAt: string;
  }>;
  quotes: Array<{
    id: string;
    quoteNumber: string;
    status: string;
    productType: string;
    createdAt: string;
  }>;
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    invoiceType: string;
    status: string;
    totalInclVat: string;
    dueDate: string | null;
    createdAt: string;
  }>;
  metrics: {
    totalQuotesCount: number;
    activeProjectsCount: number;
    completedProjectsCount: number;
    lifetimeSpend: string;
    totalInvoiced: string;
    outstandingBalance: string;
  };
}

export interface CustomerQueryFilters {
  search?: string;
  city?: string;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'lastName' | 'city' | 'customerNumber';
  sortOrder?: 'asc' | 'desc';
}
