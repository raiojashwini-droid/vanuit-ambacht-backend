import { eq, or, ilike, sql, desc, asc, and } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { customers, projects, quotes, invoices, users } from '../../db/schema.js';
import type { CreateCustomerInput, UpdateCustomerInput, CustomerQueryParams } from './customer.schema.js';
import type { CustomerListItem, CustomerDossier } from './customer.types.js';

export class CustomerError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 400, code = 'CUSTOMER_ERROR') {
    super(message);
    this.name = 'CustomerError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class CustomerService {
  /**
   * Generates a unique sequential customer number in format CUST-YYYY-XXX
   */
  async generateCustomerNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `CUST-${year}-`;

    const [latest] = await db
      .select({ customerNumber: customers.customerNumber })
      .from(customers)
      .where(ilike(customers.customerNumber, `${prefix}%`))
      .orderBy(desc(customers.customerNumber))
      .limit(1);

    if (!latest) {
      return `${prefix}001`;
    }

    const currentNumber = parseInt(latest.customerNumber.replace(prefix, ''), 10);
    const nextSeq = isNaN(currentNumber) ? 1 : currentNumber + 1;
    return `${prefix}${nextSeq.toString().padStart(3, '0')}`;
  }

  /**
   * List customers with search, city filter, sorting, and pagination
   */
  async list(params: CustomerQueryParams) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const offset = (page - 1) * limit;

    const conditions = [];

    if (params.search) {
      const term = `%${params.search.trim()}%`;
      conditions.push(
        or(
          ilike(customers.firstName, term),
          ilike(customers.lastName, term),
          ilike(customers.companyName, term),
          ilike(customers.email, term),
          ilike(customers.phone, term),
          ilike(customers.city, term),
          ilike(customers.customerNumber, term)
        )
      );
    }

    if (params.city) {
      conditions.push(ilike(customers.city, `%${params.city.trim()}%`));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Count total matching
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(customers)
      .where(whereClause);

    const total = countResult?.count || 0;

    // Determine sort column
    let orderExpr = desc(customers.createdAt);
    if (params.sortBy === 'lastName') {
      orderExpr = params.sortOrder === 'asc' ? asc(customers.lastName) : desc(customers.lastName);
    } else if (params.sortBy === 'city') {
      orderExpr = params.sortOrder === 'asc' ? asc(customers.city) : desc(customers.city);
    } else if (params.sortBy === 'customerNumber') {
      orderExpr = params.sortOrder === 'asc' ? asc(customers.customerNumber) : desc(customers.customerNumber);
    } else {
      orderExpr = params.sortOrder === 'asc' ? asc(customers.createdAt) : desc(customers.createdAt);
    }

    const rows = await db
      .select()
      .from(customers)
      .where(whereClause)
      .orderBy(orderExpr)
      .limit(limit)
      .offset(offset);

    const items: CustomerListItem[] = rows.map((r) => ({
      id: r.id,
      customerNumber: r.customerNumber,
      companyName: r.companyName,
      firstName: r.firstName,
      lastName: r.lastName,
      fullName: `${r.firstName} ${r.lastName}`.trim(),
      email: r.email,
      phone: r.phone,
      streetAddress: r.streetAddress,
      postalCode: r.postalCode,
      city: r.city,
      country: r.country,
      notes: r.notes,
      userId: r.userId,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Retrieves complete Customer Dossier including linked projects, quotes, invoices, and spend metrics
   */
  async getDossier(id: string): Promise<CustomerDossier> {
    const [customerRecord] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1);

    if (!customerRecord) {
      throw new CustomerError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
    }

    // 1. Linked Projects
    const customerProjects = await db
      .select({
        id: projects.id,
        projectNumber: projects.projectNumber,
        name: projects.name,
        projectType: projects.projectType,
        status: projects.status,
        progressPercentage: projects.progressPercentage,
        contractValue: projects.contractValue,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .where(eq(projects.customerId, id))
      .orderBy(desc(projects.createdAt));

    // 2. Linked Quotes
    const customerQuotes = await db
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        status: quotes.status,
        productType: quotes.productType,
        createdAt: quotes.createdAt,
      })
      .from(quotes)
      .where(eq(quotes.customerId, id))
      .orderBy(desc(quotes.createdAt));

    // 3. Linked Invoices
    const customerInvoices = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        invoiceType: invoices.invoiceType,
        status: invoices.status,
        totalInclVat: invoices.totalInclVat,
        dueDate: invoices.dueDate,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .where(eq(invoices.customerId, id))
      .orderBy(desc(invoices.createdAt));

    // Calculate Financial Metrics
    let lifetimeSpendNum = 0;
    let totalInvoicedNum = 0;
    let outstandingBalanceNum = 0;

    for (const inv of customerInvoices) {
      const invTotal = parseFloat(inv.totalInclVat || '0');
      totalInvoicedNum += invTotal;
      if (inv.status === 'paid') {
        lifetimeSpendNum += invTotal;
      } else if (inv.status !== 'credited') {
        outstandingBalanceNum += invTotal;
      }
    }

    const activeProjectsCount = customerProjects.filter((p) => p.status === 'in_progress').length;
    const completedProjectsCount = customerProjects.filter((p) => p.status === 'completed').length;

    return {
      id: customerRecord.id,
      customerNumber: customerRecord.customerNumber,
      companyName: customerRecord.companyName,
      firstName: customerRecord.firstName,
      lastName: customerRecord.lastName,
      fullName: `${customerRecord.firstName} ${customerRecord.lastName}`.trim(),
      email: customerRecord.email,
      phone: customerRecord.phone,
      streetAddress: customerRecord.streetAddress,
      postalCode: customerRecord.postalCode,
      city: customerRecord.city,
      country: customerRecord.country,
      notes: customerRecord.notes,
      userId: customerRecord.userId,
      createdAt: customerRecord.createdAt.toISOString(),
      updatedAt: customerRecord.updatedAt.toISOString(),
      projects: customerProjects.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
      })),
      quotes: customerQuotes.map((q) => ({
        ...q,
        createdAt: q.createdAt.toISOString(),
      })),
      invoices: customerInvoices.map((inv) => ({
        ...inv,
        dueDate: typeof inv.dueDate === 'string' ? inv.dueDate : (inv.dueDate as any)?.toISOString?.().split('T')[0] || null,
        createdAt: inv.createdAt.toISOString(),
      })),
      metrics: {
        totalQuotesCount: customerQuotes.length,
        activeProjectsCount,
        completedProjectsCount,
        lifetimeSpend: lifetimeSpendNum.toFixed(2),
        totalInvoiced: totalInvoicedNum.toFixed(2),
        outstandingBalance: outstandingBalanceNum.toFixed(2),
      },
    };
  }

  /**
   * Create a new customer with auto-numbering and duplicate protection
   */
  async create(data: CreateCustomerInput): Promise<CustomerListItem> {
    const customerNumber = data.customerNumber || (await this.generateCustomerNumber());

    // Check if customerNumber already in use
    const [existingNum] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.customerNumber, customerNumber))
      .limit(1);

    if (existingNum) {
      throw new CustomerError(`Customer number '${customerNumber}' is already in use`, 409, 'DUPLICATE_NUMBER');
    }

    // If userId supplied, check if exists in users
    if (data.userId) {
      const [existingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, data.userId))
        .limit(1);

      if (!existingUser) {
        throw new CustomerError('Linked user ID does not exist', 400, 'USER_NOT_FOUND');
      }
    }

    const [created] = await db
      .insert(customers)
      .values({
        customerNumber,
        companyName: data.companyName || null,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email.toLowerCase(),
        phone: data.phone,
        streetAddress: data.streetAddress || null,
        postalCode: data.postalCode || null,
        city: data.city,
        country: data.country || 'NL',
        notes: data.notes || null,
        userId: data.userId || null,
      })
      .returning();

    return {
      id: created.id,
      customerNumber: created.customerNumber,
      companyName: created.companyName,
      firstName: created.firstName,
      lastName: created.lastName,
      fullName: `${created.firstName} ${created.lastName}`.trim(),
      email: created.email,
      phone: created.phone,
      streetAddress: created.streetAddress,
      postalCode: created.postalCode,
      city: created.city,
      country: created.country,
      notes: created.notes,
      userId: created.userId,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  /**
   * Update customer record
   */
  async update(id: string, data: UpdateCustomerInput): Promise<CustomerListItem> {
    const [existing] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1);

    if (!existing) {
      throw new CustomerError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
    }

    // If updating customerNumber, check uniqueness
    if (data.customerNumber && data.customerNumber !== existing.customerNumber) {
      const [duplicate] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.customerNumber, data.customerNumber))
        .limit(1);

      if (duplicate) {
        throw new CustomerError(`Customer number '${data.customerNumber}' is already in use`, 409, 'DUPLICATE_NUMBER');
      }
    }

    const [updated] = await db
      .update(customers)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, id))
      .returning();

    return {
      id: updated.id,
      customerNumber: updated.customerNumber,
      companyName: updated.companyName,
      firstName: updated.firstName,
      lastName: updated.lastName,
      fullName: `${updated.firstName} ${updated.lastName}`.trim(),
      email: updated.email,
      phone: updated.phone,
      streetAddress: updated.streetAddress,
      postalCode: updated.postalCode,
      city: updated.city,
      country: updated.country,
      notes: updated.notes,
      userId: updated.userId,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Delete customer with dependency checks
   */
  async delete(id: string): Promise<{ deleted: boolean; customerNumber: string }> {
    const [existing] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1);

    if (!existing) {
      throw new CustomerError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
    }

    // Check for active projects
    const [hasProjects] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.customerId, id))
      .limit(1);

    if (hasProjects) {
      throw new CustomerError(
        'Cannot delete customer: Active project records are linked to this customer. Archive the projects first.',
        409,
        'CUSTOMER_HAS_PROJECTS'
      );
    }

    // Check for invoices
    const [hasInvoices] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.customerId, id))
      .limit(1);

    if (hasInvoices) {
      throw new CustomerError(
        'Cannot delete customer: Financial invoice history exists for this customer. Retention is required for tax audit.',
        409,
        'CUSTOMER_HAS_INVOICES'
      );
    }

    await db.delete(customers).where(eq(customers.id, id));

    return {
      deleted: true,
      customerNumber: existing.customerNumber,
    };
  }
}

export const customerService = new CustomerService();
