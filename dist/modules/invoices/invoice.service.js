import { db } from '../../db/index.js';
import { invoices, invoiceItems, payments, projects, customers, projectMilestones, leads, companySettings, } from '../../db/schema.js';
import { eq, and, desc, asc, ilike, sql, or, inArray } from 'drizzle-orm';
import { accountingService } from '../accounting/accounting.service.js';
export class InvoiceError extends Error {
    statusCode;
    code;
    constructor(message, statusCode = 400, code = 'INVOICE_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
    }
}
export class InvoiceService {
    /**
     * Generates a sequential invoice number: INV-YYYY-XXX or CR-YYYY-XXX
     */
    async generateInvoiceNumber(prefix = 'INV', offset = 0, executor = db) {
        const year = new Date().getFullYear();
        let searchPrefix = `${prefix}-${year}-`;
        if (prefix === 'INV') {
            const [comp] = await executor.select({ invoicePrefix: companySettings.invoicePrefix }).from(companySettings).limit(1);
            let raw = comp?.invoicePrefix?.trim() || `INV-${year}`;
            raw = raw.replace(/^#/, '');
            searchPrefix = raw.endsWith('-') ? raw : `${raw}-`;
        }
        const [latest] = await executor
            .select({ invoiceNumber: invoices.invoiceNumber })
            .from(invoices)
            .where(ilike(invoices.invoiceNumber, `${searchPrefix}%`))
            .orderBy(desc(invoices.invoiceNumber))
            .limit(1);
        const baseSeq = latest
            ? parseInt(latest.invoiceNumber.replace(searchPrefix, ''), 10) || 0
            : 0;
        const nextSeq = baseSeq + 1 + offset;
        return `${searchPrefix}${nextSeq.toString().padStart(3, '0')}`;
    }
    /**
     * Generates sequential payment number: PAY-YYYY-XXX
     */
    async generatePaymentNumber(offset = 0, executor = db) {
        const year = new Date().getFullYear();
        const prefix = `PAY-${year}-`;
        const [latest] = await executor
            .select({ paymentNumber: payments.paymentNumber })
            .from(payments)
            .where(ilike(payments.paymentNumber, `${prefix}%`))
            .orderBy(desc(payments.paymentNumber))
            .limit(1);
        const baseSeq = latest
            ? parseInt(latest.paymentNumber.replace(prefix, ''), 10) || 0
            : 0;
        const nextSeq = baseSeq + 1 + offset;
        return `${prefix}${nextSeq.toString().padStart(3, '0')}`;
    }
    /**
     * Line items calculation engine
     */
    calculateItems(rawItems) {
        let subtotalExclVat = 0;
        let totalVatAmount = 0;
        let totalInclVat = 0;
        const processedItems = rawItems.map((item, index) => {
            const position = item.position || index + 1;
            const quantity = item.quantity !== undefined ? parseFloat(String(item.quantity)) : 1;
            const vatRate = item.vatRate !== undefined ? parseFloat(String(item.vatRate)) : 21.0;
            const isIncluded = Boolean(item.isIncluded);
            let unitPriceExcl = 0;
            let lineTotalExcl = 0;
            let lineTotalIncl = 0;
            if (!isIncluded) {
                if (item.unitPriceExclVat !== undefined) {
                    unitPriceExcl = parseFloat(String(item.unitPriceExclVat));
                }
                else if (item.unitPriceInclVat !== undefined) {
                    const incl = parseFloat(String(item.unitPriceInclVat));
                    unitPriceExcl = Math.round((incl / (1 + vatRate / 100)) * 100) / 100;
                }
                lineTotalExcl = Math.round(quantity * unitPriceExcl * 100) / 100;
                const lineVat = Math.round(lineTotalExcl * (vatRate / 100) * 100) / 100;
                lineTotalIncl = Math.round((lineTotalExcl + lineVat) * 100) / 100;
            }
            subtotalExclVat += lineTotalExcl;
            totalInclVat += lineTotalIncl;
            return {
                position,
                description: item.description,
                subtext: item.subtext || null,
                quantity,
                unitPriceExclVat: unitPriceExcl,
                vatRate,
                lineTotalExclVat: lineTotalExcl,
                lineTotalInclVat: lineTotalIncl,
                isIncluded,
            };
        });
        subtotalExclVat = Math.round(subtotalExclVat * 100) / 100;
        totalInclVat = Math.round(totalInclVat * 100) / 100;
        totalVatAmount = Math.round((totalInclVat - subtotalExclVat) * 100) / 100;
        return {
            subtotalExclVat,
            totalVatAmount,
            totalInclVat,
            items: processedItems,
        };
    }
    /**
     * Helper to map row to DTO
     */
    mapToDto(inv, extra) {
        const totalIncl = parseFloat(inv.totalInclVat || '0');
        const totalPaid = extra?.totalPaid !== undefined ? extra.totalPaid : 0;
        const outstanding = Math.max(0, Math.round((totalIncl - totalPaid) * 100) / 100);
        return {
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            projectId: inv.projectId,
            customerId: inv.customerId,
            quoteId: inv.quoteId,
            milestoneId: inv.milestoneId,
            originalInvoiceId: inv.originalInvoiceId,
            creditReason: inv.creditReason,
            invoiceType: inv.invoiceType,
            status: inv.status,
            subtotalExclVat: parseFloat(inv.subtotalExclVat || '0'),
            totalVatAmount: parseFloat(inv.totalVatAmount || '0'),
            totalInclVat: totalIncl,
            totalPaid,
            outstandingBalance: inv.status === 'credited' ? 0 : outstanding,
            issueDate: String(inv.issueDate).split('T')[0],
            dueDate: String(inv.dueDate).split('T')[0],
            paidDate: inv.paidDate ? String(inv.paidDate).split('T')[0] : null,
            paymentTermsDays: inv.paymentTermsDays || 14,
            notes: inv.notes,
            customerName: extra?.customerName,
            customerEmail: extra?.customerEmail,
            projectName: extra?.projectName,
            projectNumber: extra?.projectNumber,
            items: extra?.items,
            createdAt: inv.createdAt ? new Date(inv.createdAt).toISOString() : new Date().toISOString(),
            updatedAt: inv.updatedAt ? new Date(inv.updatedAt).toISOString() : new Date().toISOString(),
        };
    }
    /**
     * GET /api/invoices
     * List all invoices with filters and search (Admin only)
     */
    async list(query, user) {
        if (user.role === 'partner') {
            throw new InvoiceError('Partners are not authorized to view customer invoices', 403, 'FORBIDDEN');
        }
        const page = query.page || 1;
        const limit = query.limit || 25;
        const offset = (page - 1) * limit;
        const conditions = [];
        if (query.status && query.status !== 'all') {
            conditions.push(eq(invoices.status, query.status));
        }
        if (query.customerId) {
            conditions.push(eq(invoices.customerId, query.customerId));
        }
        if (query.projectId) {
            conditions.push(eq(invoices.projectId, query.projectId));
        }
        // Customer scoping: customer only sees their own invoices
        if (user.role === 'customer') {
            const custId = user.profileId ||
                (await db
                    .select({ id: customers.id })
                    .from(customers)
                    .where(eq(customers.userId, user.sub))
                    .limit(1))[0]?.id;
            if (!custId) {
                return { data: [], total: 0, page, limit, totalPages: 0 };
            }
            conditions.push(eq(invoices.customerId, custId));
        }
        if (query.search && query.search.trim() !== '') {
            const q = `%${query.search.trim()}%`;
            conditions.push(or(ilike(invoices.invoiceNumber, q), ilike(customers.firstName, q), ilike(customers.lastName, q), ilike(customers.companyName, q), ilike(projects.name, q), ilike(projects.projectNumber, q)));
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        // Total Count
        const [countResult] = await db
            .select({ count: sql `count(*)::int` })
            .from(invoices)
            .leftJoin(customers, eq(invoices.customerId, customers.id))
            .leftJoin(projects, eq(invoices.projectId, projects.id))
            .where(whereClause);
        const total = countResult?.count || 0;
        // Sort order
        let orderByClause = desc(invoices.createdAt);
        if (query.sortBy === 'oldest') {
            orderByClause = asc(invoices.createdAt);
        }
        else if (query.sortBy === 'amount-desc') {
            orderByClause = desc(invoices.totalInclVat);
        }
        else if (query.sortBy === 'amount-asc') {
            orderByClause = asc(invoices.totalInclVat);
        }
        // Rows
        const rows = await db
            .select({
            invoice: invoices,
            customerFirstName: customers.firstName,
            customerLastName: customers.lastName,
            customerCompanyName: customers.companyName,
            customerEmail: customers.email,
            projectName: projects.name,
            projectNumber: projects.projectNumber,
        })
            .from(invoices)
            .leftJoin(customers, eq(invoices.customerId, customers.id))
            .leftJoin(projects, eq(invoices.projectId, projects.id))
            .where(whereClause)
            .orderBy(orderByClause)
            .limit(limit)
            .offset(offset);
        // Get payments for these invoices
        const invoiceIds = rows.map((r) => r.invoice.id);
        const paymentsList = invoiceIds.length > 0
            ? await db
                .select({
                invoiceId: payments.invoiceId,
                amount: payments.amount,
                status: payments.status,
            })
                .from(payments)
                .where(and(inArray(payments.invoiceId, invoiceIds), eq(payments.status, 'succeeded')))
            : [];
        const paymentMap = {};
        paymentsList.forEach((p) => {
            const amt = parseFloat(p.amount || '0');
            paymentMap[p.invoiceId] = (paymentMap[p.invoiceId] || 0) + amt;
        });
        const data = rows.map((r) => {
            const custName = r.customerCompanyName
                ? `${r.customerCompanyName} (${r.customerFirstName || ''} ${r.customerLastName || ''})`.trim()
                : `${r.customerFirstName || ''} ${r.customerLastName || ''}`.trim();
            const totalPaid = paymentMap[r.invoice.id] || 0;
            return this.mapToDto(r.invoice, {
                totalPaid,
                customerName: custName,
                customerEmail: r.customerEmail || undefined,
                projectName: r.projectName || undefined,
                projectNumber: r.projectNumber || undefined,
            });
        });
        return {
            data,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 1,
        };
    }
    /**
     * GET /api/invoices/summary
     * Aggregated financial KPI metrics
     */
    async getSummary(user) {
        if (user.role === 'partner') {
            throw new InvoiceError('Partners are not authorized to view invoice summaries', 403, 'FORBIDDEN');
        }
        const allInvoices = await db.select().from(invoices);
        const allPayments = await db
            .select()
            .from(payments)
            .where(eq(payments.status, 'succeeded'));
        const paymentMap = {};
        allPayments.forEach((p) => {
            paymentMap[p.invoiceId] = (paymentMap[p.invoiceId] || 0) + parseFloat(p.amount || '0');
        });
        const todayStr = new Date().toISOString().split('T')[0];
        let totalCount = 0;
        let totalAmount = 0;
        let paidCount = 0;
        let paidSum = 0;
        let pendingCount = 0;
        let pendingSum = 0;
        let overdueCount = 0;
        let overdueSum = 0;
        for (const inv of allInvoices) {
            if (inv.invoiceType === 'credit_note')
                continue; // exclude credit notes from gross sales count
            const totalIncl = parseFloat(inv.totalInclVat || '0');
            const paidAmt = paymentMap[inv.id] || 0;
            const outstanding = Math.max(0, totalIncl - paidAmt);
            totalCount++;
            totalAmount += totalIncl;
            if (inv.status === 'paid' || paidAmt >= totalIncl) {
                paidCount++;
                paidSum += totalIncl;
            }
            else if (inv.status !== 'credited') {
                const isOverdue = inv.status === 'overdue' || String(inv.dueDate).split('T')[0] < todayStr;
                if (isOverdue) {
                    overdueCount++;
                    overdueSum += outstanding;
                }
                else {
                    pendingCount++;
                    pendingSum += outstanding;
                }
            }
        }
        return {
            totalCount,
            totalAmount: Math.round(totalAmount * 100) / 100,
            paidCount,
            paidSum: Math.round(paidSum * 100) / 100,
            pendingCount,
            pendingSum: Math.round(pendingSum * 100) / 100,
            overdueCount,
            overdueSum: Math.round(overdueSum * 100) / 100,
        };
    }
    /**
     * GET /api/invoices/:id
     * Get single invoice dossier with items and payment history
     */
    async getById(id, user) {
        if (user.role === 'partner') {
            throw new InvoiceError('Partners are not authorized to view customer invoices', 403, 'FORBIDDEN');
        }
        const [row] = await db
            .select({
            invoice: invoices,
            customerFirstName: customers.firstName,
            customerLastName: customers.lastName,
            customerCompanyName: customers.companyName,
            customerEmail: customers.email,
            customerUserId: customers.userId,
            projectName: projects.name,
            projectNumber: projects.projectNumber,
        })
            .from(invoices)
            .leftJoin(customers, eq(invoices.customerId, customers.id))
            .leftJoin(projects, eq(invoices.projectId, projects.id))
            .where(eq(invoices.id, id))
            .limit(1);
        if (!row) {
            throw new InvoiceError('Invoice not found', 404, 'NOT_FOUND');
        }
        // Customer scoping: Customers can ONLY view invoices linked to their own customer record
        if (user.role === 'customer') {
            const custId = user.profileId ||
                (await db
                    .select({ id: customers.id })
                    .from(customers)
                    .where(eq(customers.userId, user.sub))
                    .limit(1))[0]?.id;
            if (!custId || custId !== row.invoice.customerId) {
                throw new InvoiceError('You are not authorized to view this invoice', 403, 'FORBIDDEN');
            }
        }
        const items = await db
            .select()
            .from(invoiceItems)
            .where(eq(invoiceItems.invoiceId, id))
            .orderBy(invoiceItems.position);
        const invoicePayments = await db
            .select()
            .from(payments)
            .where(and(eq(payments.invoiceId, id), eq(payments.status, 'succeeded')));
        const totalPaid = invoicePayments.reduce((acc, p) => acc + parseFloat(p.amount || '0'), 0);
        const custName = row.customerCompanyName
            ? `${row.customerCompanyName} (${row.customerFirstName || ''} ${row.customerLastName || ''})`.trim()
            : `${row.customerFirstName || ''} ${row.customerLastName || ''}`.trim();
        const itemDtos = items.map((it) => ({
            id: it.id,
            invoiceId: it.invoiceId,
            position: it.position,
            description: it.description,
            subtext: it.subtext,
            quantity: parseFloat(it.quantity || '1'),
            unitPriceExclVat: parseFloat(it.unitPriceExclVat || '0'),
            vatRate: parseFloat(it.vatRate || '21'),
            lineTotalExclVat: parseFloat(it.lineTotalExclVat || '0'),
            lineTotalInclVat: parseFloat(it.lineTotalInclVat || '0'),
            isIncluded: it.isIncluded,
            createdAt: it.createdAt ? new Date(it.createdAt).toISOString() : new Date().toISOString(),
        }));
        return this.mapToDto(row.invoice, {
            items: itemDtos,
            totalPaid: Math.round(totalPaid * 100) / 100,
            customerName: custName,
            customerEmail: row.customerEmail || undefined,
            projectName: row.projectName || undefined,
            projectNumber: row.projectNumber || undefined,
        });
    }
    /**
     * POST /api/invoices
     * Create a new invoice with atomic transaction (Admin only)
     */
    async create(data, user) {
        if (user.role !== 'admin') {
            throw new InvoiceError('Only administrators can create invoices', 403, 'FORBIDDEN');
        }
        // Verify project exists
        const [project] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, data.projectId))
            .limit(1);
        if (!project) {
            throw new InvoiceError('Project not found', 404, 'PROJECT_NOT_FOUND');
        }
        const customerId = data.customerId || project.customerId;
        const calculated = this.calculateItems(data.items);
        const todayStr = new Date().toISOString().split('T')[0];
        const issueDate = data.issueDate || todayStr;
        const paymentTermsDays = data.paymentTermsDays || 14;
        const dueDate = data.dueDate ||
            new Date(new Date(issueDate).getTime() + paymentTermsDays * 24 * 60 * 60 * 1000)
                .toISOString()
                .split('T')[0];
        const invoiceNumber = await this.generateInvoiceNumber('INV');
        const createdInvoiceId = await db.transaction(async (tx) => {
            const [newInv] = await tx
                .insert(invoices)
                .values({
                invoiceNumber,
                projectId: data.projectId,
                customerId,
                quoteId: data.quoteId || project.quoteId,
                milestoneId: data.milestoneId || null,
                invoiceType: data.invoiceType || 'down_payment_upfront',
                status: data.status || 'draft',
                subtotalExclVat: sql `${calculated.subtotalExclVat}::numeric`,
                totalVatAmount: sql `${calculated.totalVatAmount}::numeric`,
                totalInclVat: sql `${calculated.totalInclVat}::numeric`,
                issueDate,
                dueDate,
                paymentTermsDays,
                notes: data.notes || null,
            })
                .returning();
            // Insert line items
            for (const item of calculated.items) {
                await tx.insert(invoiceItems).values({
                    invoiceId: newInv.id,
                    position: item.position,
                    description: item.description,
                    subtext: item.subtext,
                    quantity: sql `${item.quantity}::numeric`,
                    unitPriceExclVat: sql `${item.unitPriceExclVat}::numeric`,
                    vatRate: sql `${item.vatRate}::numeric`,
                    lineTotalExclVat: sql `${item.lineTotalExclVat}::numeric`,
                    lineTotalInclVat: sql `${item.lineTotalInclVat}::numeric`,
                    isIncluded: item.isIncluded,
                });
            }
            return newInv.id;
        });
        return await this.getById(createdInvoiceId, user);
    }
    /**
     * PATCH /api/invoices/:id
     * Update invoice (Admin only, allowed ONLY in draft status)
     */
    async update(id, data, user) {
        if (user.role !== 'admin') {
            throw new InvoiceError('Only administrators can update invoices', 403, 'FORBIDDEN');
        }
        const [existing] = await db
            .select()
            .from(invoices)
            .where(eq(invoices.id, id))
            .limit(1);
        if (!existing) {
            throw new InvoiceError('Invoice not found', 404, 'NOT_FOUND');
        }
        // Belastingdienst Compliance: Only drafts can be modified!
        if (existing.status !== 'draft') {
            throw new InvoiceError('Belastingdienst compliance: Finalized or sent invoices cannot be modified. Issue a credit note instead.', 400, 'INVOICE_LOCKED');
        }
        await db.transaction(async (tx) => {
            const updatePayload = {
                updatedAt: new Date(),
            };
            if (data.projectId)
                updatePayload.projectId = data.projectId;
            if (data.quoteId !== undefined)
                updatePayload.quoteId = data.quoteId;
            if (data.milestoneId !== undefined)
                updatePayload.milestoneId = data.milestoneId;
            if (data.invoiceType)
                updatePayload.invoiceType = data.invoiceType;
            if (data.issueDate)
                updatePayload.issueDate = data.issueDate;
            if (data.dueDate)
                updatePayload.dueDate = data.dueDate;
            if (data.paymentTermsDays !== undefined)
                updatePayload.paymentTermsDays = data.paymentTermsDays;
            if (data.notes !== undefined)
                updatePayload.notes = data.notes;
            // If items provided, recalculate and replace items
            if (data.items && data.items.length > 0) {
                const calculated = this.calculateItems(data.items);
                updatePayload.subtotalExclVat = sql `${calculated.subtotalExclVat}::numeric`;
                updatePayload.totalVatAmount = sql `${calculated.totalVatAmount}::numeric`;
                updatePayload.totalInclVat = sql `${calculated.totalInclVat}::numeric`;
                await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id));
                for (const item of calculated.items) {
                    await tx.insert(invoiceItems).values({
                        invoiceId: id,
                        position: item.position,
                        description: item.description,
                        subtext: item.subtext,
                        quantity: sql `${item.quantity}::numeric`,
                        unitPriceExclVat: sql `${item.unitPriceExclVat}::numeric`,
                        vatRate: sql `${item.vatRate}::numeric`,
                        lineTotalExclVat: sql `${item.lineTotalExclVat}::numeric`,
                        lineTotalInclVat: sql `${item.lineTotalInclVat}::numeric`,
                        isIncluded: item.isIncluded,
                    });
                }
            }
            await tx.update(invoices).set(updatePayload).where(eq(invoices.id, id));
        });
        return await this.getById(id, user);
    }
    /**
     * DELETE /api/invoices/:id
     * Delete invoice (Admin only, allowed ONLY in draft status with no payments)
     */
    async delete(id, user) {
        if (user.role !== 'admin') {
            throw new InvoiceError('Only administrators can delete invoices', 403, 'FORBIDDEN');
        }
        const [existing] = await db
            .select()
            .from(invoices)
            .where(eq(invoices.id, id))
            .limit(1);
        if (!existing) {
            throw new InvoiceError('Invoice not found', 404, 'NOT_FOUND');
        }
        if (existing.status !== 'draft') {
            throw new InvoiceError('Belastingdienst compliance: Finalized or sent invoices cannot be deleted. Issue a credit note instead.', 400, 'CANNOT_DELETE_FINALIZED_INVOICE');
        }
        // Check payments
        const [payCount] = await db
            .select({ count: sql `count(*)::int` })
            .from(payments)
            .where(eq(payments.invoiceId, id));
        if (payCount && payCount.count > 0) {
            throw new InvoiceError('Cannot delete invoice with existing payment records.', 400, 'INVOICE_HAS_PAYMENTS');
        }
        await db.transaction(async (tx) => {
            await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id));
            await tx.delete(invoices).where(eq(invoices.id, id));
        });
        return {
            success: true,
            message: `Invoice ${existing.invoiceNumber} deleted successfully.`,
        };
    }
    /**
     * POST /api/invoices/:id/send
     * Lock invoice content, set status to sent, sync customer/lead (Admin only)
     */
    async sendInvoice(id, user) {
        if (user.role !== 'admin') {
            throw new InvoiceError('Only administrators can send invoices', 403, 'FORBIDDEN');
        }
        const [existing] = await db
            .select()
            .from(invoices)
            .where(eq(invoices.id, id))
            .limit(1);
        if (!existing) {
            throw new InvoiceError('Invoice not found', 404, 'NOT_FOUND');
        }
        if (existing.status === 'credited') {
            throw new InvoiceError('Cannot send a credited invoice', 400, 'INVOICE_CREDITED');
        }
        await db.transaction(async (tx) => {
            await tx
                .update(invoices)
                .set({
                status: 'sent',
                issueDate: existing.issueDate || sql `CURRENT_DATE`,
                updatedAt: new Date(),
            })
                .where(eq(invoices.id, id));
            // Check linked project and lead conversion
            const [proj] = await tx
                .select()
                .from(projects)
                .where(eq(projects.id, existing.projectId))
                .limit(1);
            if (proj && proj.quoteId) {
                const [linkedLead] = await tx
                    .select()
                    .from(leads)
                    .where(eq(leads.id, proj.customerId))
                    .limit(1);
                if (linkedLead && linkedLead.status !== 'won') {
                    await tx
                        .update(leads)
                        .set({ status: 'won', workflowStep: 7, updatedAt: new Date() })
                        .where(eq(leads.id, linkedLead.id));
                }
            }
            // MODULE 8 HOOK: Post balanced double-entry for SENT sales invoice
            await accountingService.postSalesInvoiceEntry(id, tx);
        });
        return await this.getById(id, user);
    }
    /**
     * POST /api/invoices/:id/mark-paid
     * Record manual bank payment and mark invoice as paid (Admin only)
     */
    async markAsPaid(id, input, user) {
        if (user.role !== 'admin') {
            throw new InvoiceError('Only administrators can mark invoices as paid', 403, 'FORBIDDEN');
        }
        const [existing] = await db
            .select()
            .from(invoices)
            .where(eq(invoices.id, id))
            .limit(1);
        if (!existing) {
            throw new InvoiceError('Invoice not found', 404, 'NOT_FOUND');
        }
        if (existing.status === 'credited') {
            throw new InvoiceError('Cannot record payment for a credited invoice', 400, 'INVOICE_CREDITED');
        }
        const totalIncl = parseFloat(existing.totalInclVat || '0');
        const existingPayments = await db
            .select()
            .from(payments)
            .where(and(eq(payments.invoiceId, id), eq(payments.status, 'succeeded')));
        const currentPaidSum = existingPayments.reduce((acc, p) => acc + parseFloat(p.amount || '0'), 0);
        const paymentAmount = input.amount !== undefined ? input.amount : Math.max(0, totalIncl - currentPaidSum);
        if (paymentAmount <= 0) {
            throw new InvoiceError('Invoice is already fully paid', 400, 'ALREADY_PAID');
        }
        const paymentNumber = await this.generatePaymentNumber(0);
        const todayStr = input.paidDate || new Date().toISOString().split('T')[0];
        await db.transaction(async (tx) => {
            // 1. Insert payment record
            await tx.insert(payments).values({
                paymentNumber,
                invoiceId: id,
                amount: sql `${paymentAmount}::numeric`,
                paymentMethod: input.paymentMethod || 'bank_transfer_abn',
                paymentReference: input.paymentReference || `Manual settlement: ${existing.invoiceNumber}`,
                status: 'succeeded',
                paidAt: new Date(todayStr),
            });
            // 2. Determine new invoice status
            const newPaidSum = currentPaidSum + paymentAmount;
            const isFullyPaid = newPaidSum >= totalIncl;
            await tx
                .update(invoices)
                .set({
                status: isFullyPaid ? 'paid' : 'partially_paid',
                paidDate: isFullyPaid ? todayStr : null,
                updatedAt: new Date(),
            })
                .where(eq(invoices.id, id));
            // 3. If invoice has linked milestone and is fully paid, complete the milestone
            if (existing.milestoneId && isFullyPaid) {
                await tx
                    .update(projectMilestones)
                    .set({
                    status: 'completed',
                    completedAt: new Date(),
                    updatedAt: new Date(),
                })
                    .where(eq(projectMilestones.id, existing.milestoneId));
            }
            // MODULE 8 HOOK: Post payment bank receipt entry (Dr 1000 Bank / Cr 1300 AR)
            const [insertedPay] = await tx
                .select({ id: payments.id })
                .from(payments)
                .where(eq(payments.paymentNumber, paymentNumber))
                .limit(1);
            if (insertedPay) {
                await accountingService.postPaymentReceiptEntry(insertedPay.id, tx);
            }
        });
        return await this.getById(id, user);
    }
    /**
     * POST /api/invoices/:id/credit-note
     * Issue an official Credit Note (CR-YYYY-XXX) with negative totals (Admin only)
     */
    async createCreditNote(id, input, user) {
        if (user.role !== 'admin') {
            throw new InvoiceError('Only administrators can issue credit notes', 403, 'FORBIDDEN');
        }
        const [target] = await db
            .select()
            .from(invoices)
            .where(eq(invoices.id, id))
            .limit(1);
        if (!target) {
            throw new InvoiceError('Original invoice not found', 404, 'NOT_FOUND');
        }
        if (target.status === 'credited') {
            throw new InvoiceError('This invoice has already been credited', 400, 'ALREADY_CREDITED');
        }
        if (target.invoiceType === 'credit_note') {
            throw new InvoiceError('Cannot issue a credit note for another credit note', 400, 'INVALID_TARGET');
        }
        const originalItems = await db
            .select()
            .from(invoiceItems)
            .where(eq(invoiceItems.invoiceId, id))
            .orderBy(invoiceItems.position);
        const creditNoteNumber = await this.generateInvoiceNumber('CR');
        const todayStr = input.issueDate || new Date().toISOString().split('T')[0];
        const subtotalExclNeg = -Math.abs(parseFloat(target.subtotalExclVat || '0'));
        const vatNeg = -Math.abs(parseFloat(target.totalVatAmount || '0'));
        const totalInclNeg = -Math.abs(parseFloat(target.totalInclVat || '0'));
        const creditNoteId = await db.transaction(async (tx) => {
            // 1. Create credit note invoice record
            const [crInv] = await tx
                .insert(invoices)
                .values({
                invoiceNumber: creditNoteNumber,
                projectId: target.projectId,
                customerId: target.customerId,
                quoteId: target.quoteId,
                milestoneId: target.milestoneId,
                originalInvoiceId: target.id,
                creditReason: input.reason,
                invoiceType: 'credit_note',
                status: 'sent', // Credit notes are immediately valid legal documents
                subtotalExclVat: sql `${subtotalExclNeg}::numeric`,
                totalVatAmount: sql `${vatNeg}::numeric`,
                totalInclVat: sql `${totalInclNeg}::numeric`,
                issueDate: todayStr,
                dueDate: todayStr,
                paymentTermsDays: 0,
                notes: `Creditering van factuur ${target.invoiceNumber}. Reden: ${input.reason}`,
            })
                .returning();
            // 2. Copy items with negative amounts
            for (const item of originalItems) {
                const itemLineExclNeg = -Math.abs(parseFloat(item.lineTotalExclVat || '0'));
                const itemLineInclNeg = -Math.abs(parseFloat(item.lineTotalInclVat || '0'));
                const itemUnitExclNeg = -Math.abs(parseFloat(item.unitPriceExclVat || '0'));
                await tx.insert(invoiceItems).values({
                    invoiceId: crInv.id,
                    position: item.position,
                    description: `Creditering: ${item.description}`,
                    subtext: item.subtext ? `Oorspronkelijk: ${item.subtext}` : null,
                    quantity: item.quantity,
                    unitPriceExclVat: sql `${itemUnitExclNeg}::numeric`,
                    vatRate: item.vatRate,
                    lineTotalExclVat: sql `${itemLineExclNeg}::numeric`,
                    lineTotalInclVat: sql `${itemLineInclNeg}::numeric`,
                    isIncluded: item.isIncluded,
                });
            }
            // 3. Mark original invoice as credited
            await tx
                .update(invoices)
                .set({
                status: 'credited',
                notes: target.notes
                    ? `${target.notes} | Gecrediteerd via ${creditNoteNumber}`
                    : `Gecrediteerd via ${creditNoteNumber}`,
                updatedAt: new Date(),
            })
                .where(eq(invoices.id, id));
            // MODULE 8 HOOK: Post credit note reversing double-entry
            await accountingService.postSalesInvoiceEntry(crInv.id, tx);
            return crInv.id;
        });
        const creditNote = await this.getById(creditNoteId, user);
        const originalInvoice = await this.getById(id, user);
        return { creditNote, originalInvoice };
    }
    /**
     * GET /api/customer/projects/:id/invoices
     * Customer portal: get instalment schedule for project
     */
    async getCustomerProjectInvoices(projectId, user) {
        if (user.role === 'partner') {
            throw new InvoiceError('Partners are not authorized to view customer invoices', 403, 'FORBIDDEN');
        }
        const [project] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);
        if (!project) {
            throw new InvoiceError('Project not found', 404, 'NOT_FOUND');
        }
        // Customer scoping
        if (user.role === 'customer') {
            const custId = user.profileId ||
                (await db
                    .select({ id: customers.id })
                    .from(customers)
                    .where(eq(customers.userId, user.sub))
                    .limit(1))[0]?.id;
            if (!custId || custId !== project.customerId) {
                throw new InvoiceError('You are not authorized to view this project schedule', 403, 'FORBIDDEN');
            }
        }
        const projectInvoices = await db
            .select()
            .from(invoices)
            .where(eq(invoices.projectId, projectId))
            .orderBy(asc(invoices.issueDate), asc(invoices.createdAt));
        const invoiceIds = projectInvoices.map((i) => i.id);
        const projectPayments = invoiceIds.length > 0
            ? await db
                .select()
                .from(payments)
                .where(and(inArray(payments.invoiceId, invoiceIds), eq(payments.status, 'succeeded')))
            : [];
        const paymentMap = {};
        projectPayments.forEach((p) => {
            paymentMap[p.invoiceId] = (paymentMap[p.invoiceId] || 0) + parseFloat(p.amount || '0');
        });
        const contractValue = parseFloat(project.contractValue || '0');
        let totalInvoiced = 0;
        let totalPaid = 0;
        const instalments = projectInvoices.map((inv, idx) => {
            const amtIncl = parseFloat(inv.totalInclVat || '0');
            const paidAmt = paymentMap[inv.id] || 0;
            totalInvoiced += amtIncl;
            totalPaid += paidAmt;
            let pct = 50;
            if (project.projectType === 'garden_room') {
                pct = idx === 0 ? 40 : idx === 1 ? 40 : 20;
            }
            let title = `${idx + 1}e termijn (${pct}%)`;
            if (inv.invoiceType === 'down_payment_upfront') {
                title = `1e termijn · ${pct}% bij opdracht`;
            }
            else if (inv.invoiceType === 'interim_progress') {
                title = `2e termijn · ${pct}% bij start bouw`;
            }
            else if (inv.invoiceType === 'final_completion') {
                title = `${idx + 1}e termijn · ${pct}% bij oplevering`;
            }
            else if (inv.invoiceType === 'credit_note') {
                title = `Creditering (${inv.invoiceNumber})`;
            }
            return {
                invoiceId: inv.id,
                invoiceNumber: inv.invoiceNumber,
                invoiceType: inv.invoiceType,
                status: inv.status,
                title,
                percentage: pct,
                amountInclVat: amtIncl,
                dueDate: String(inv.dueDate).split('T')[0],
                paidDate: inv.paidDate ? String(inv.paidDate).split('T')[0] : null,
                downloadUrl: `/api/invoices/${inv.id}/pdf`,
                canPayOnline: inv.status === 'sent' || inv.status === 'partially_paid' || inv.status === 'overdue',
            };
        });
        const totalOutstanding = Math.max(0, Math.round((totalInvoiced - totalPaid) * 100) / 100);
        return {
            projectId: project.id,
            projectNumber: project.projectNumber,
            projectName: project.name,
            contractValue,
            totalInvoiced: Math.round(totalInvoiced * 100) / 100,
            totalPaid: Math.round(totalPaid * 100) / 100,
            totalOutstanding,
            instalments,
        };
    }
}
export const invoiceService = new InvoiceService();
