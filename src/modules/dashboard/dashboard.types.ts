export type DateRangePreset = '7days' | '30days' | 'currentMonth' | '3months' | '6months' | '12months' | 'custom';

export interface DateRangeFilter {
  dateRange?: DateRangePreset;
  startDate?: string;
  endDate?: string;
}

export interface KpiCardMetric {
  value: string | number;
  numericValue: number;
  trend?: string;
  previousValue?: number;
  subtitle?: string;
  percentage?: number;
  status?: string;
}

export interface DashboardKpisDto {
  dateRange: string;
  startDate: string;
  endDate: string;
  totalLeads: KpiCardMetric;
  costPerLead: KpiCardMetric;
  quotesSent: KpiCardMetric;
  quotePercentage: KpiCardMetric;
  ordersWon: KpiCardMetric;
  conversionRate: KpiCardMetric;
  activeMetaAds: KpiCardMetric;
}

export interface FinancialSnapshotDto {
  revenueThisMonth: {
    value: string;
    amount: number;
    basis: string;
  };
  outstandingInvoices: {
    value: string;
    amount: number;
    count: number;
  };
  expectedRevenue: {
    value: string;
    amount: number;
  };
}

export interface FunnelStageDto {
  count: number;
  label: string;
  percentage: number;
}

export interface ConversionFunnelDto {
  leads: FunnelStageDto;
  inGesprek: FunnelStageDto;
  offerte: FunnelStageDto;
  gewonnen: FunnelStageDto;
}

export interface FollowUpItemDto {
  id: string;
  name: string;
  type: string;
  due: string;
  leadId?: string;
  quoteId?: string;
}

export interface DeliveryItemDto {
  id: string;
  project: string;
  customer: string;
  date: string;
  partner?: string;
  projectId?: string;
}

export interface DashboardTaskDto {
  id: string;
  taskNumber: string;
  title: string;
  completed: boolean;
  priority: string;
  dueDate: string;
  assignedTo?: string;
}

export interface DashboardTodayDto {
  followUps: FollowUpItemDto[];
  deliveriesThisWeek: DeliveryItemDto[];
  openTasks: DashboardTaskDto[];
}

export interface DashboardWarningDto {
  id: string;
  type: string;
  customer: string;
  detail: string;
  severity: 'warning' | 'danger' | 'info';
  referenceId?: string;
  referenceType?: 'invoice' | 'project' | 'quote' | 'lead';
}

export interface DashboardActivityDto {
  id: string;
  type: 'lead' | 'quote' | 'invoice' | 'payment' | 'project' | 'photo' | 'task';
  title: string;
  detail: string;
  timestamp: string;
  timeAgo: string;
  referenceId?: string;
}

export interface MonthlyRevenueTrendDto {
  month: string;
  monthIndex: number;
  year: number;
  val: number;
  amountFormatted: string;
}

export interface RevenueTrendsDto {
  year: number;
  totalAnnualRevenue: number;
  months: MonthlyRevenueTrendDto[];
}
