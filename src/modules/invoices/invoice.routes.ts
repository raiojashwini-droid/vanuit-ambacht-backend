import type { FastifyPluginAsync } from 'fastify';
import { db } from '../../db/index.js';
import { projects, invoices, customers } from '../../db/schema.js';
import { eq, ilike, desc, or, sql, and, ne } from 'drizzle-orm';
import { invoiceService, InvoiceError } from './invoice.service.js';
import { invoicePdfService } from './invoice-pdf.service.js';
import {
  invoiceIdParamSchema,
  projectInvoicesParamSchema,
  invoiceQuerySchema,
  createInvoiceSchema,
  updateInvoiceSchema,
  markPaidSchema,
  creditNoteSchema,
} from './invoice.schema.js';

async function resolveInvoiceId(idOrNumber: string): Promise<string | null> {
  if (!idOrNumber) return null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrNumber);
  if (isUuid) return idOrNumber;

  const [found] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.invoiceNumber, idOrNumber))
    .limit(1);

  return found?.id || null;
}

async function resolveOrCreateCustomer(
  cleanName: string,
  extra?: { email?: string; phone?: string; address?: string; city?: string }
): Promise<string> {
  const parts = cleanName.trim().split(/\s+/);
  const firstName = parts[0] || 'Klant';
  const lastName = parts.slice(1).join(' ') || 'Ambacht';

  const [existing] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(
      or(
        ilike(sql`concat(${customers.firstName}, ' ', ${customers.lastName})`, cleanName),
        and(eq(customers.firstName, firstName), eq(customers.lastName, lastName))
      )
    )
    .limit(1);

  if (existing) {
    if (extra?.phone || extra?.address || extra?.city) {
      await db
        .update(customers)
        .set({
          phone: extra.phone || undefined,
          streetAddress: extra.address || undefined,
          city: extra.city || undefined,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, existing.id));
    }
    return existing.id;
  }

  const [maxCust] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customers);
  const nextNum = `CUST-2026-${String((maxCust?.count || 0) + 1).padStart(3, '0')}`;
  const safeEmail =
    extra?.email ||
    `${firstName.toLowerCase().replace(/[^a-z0-9]/g, '')}.${Date.now().toString().slice(-4)}@vanuitambacht.nl`;

  const [newCust] = await db
    .insert(customers)
    .values({
      customerNumber: nextNum,
      firstName,
      lastName,
      email: safeEmail,
      phone: extra?.phone || '+31 6 00000000',
      city: extra?.city || 'Amsterdam',
      streetAddress: extra?.address || null,
    })
    .returning({ id: customers.id });

  return newCust.id;
}

export const invoiceRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/invoices/summary
   * Aggregated financial KPI metrics for Admin Dashboard / Invoices header
   */
  fastify.get(
    '/summary',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      try {
        const summary = await invoiceService.getSummary(request.user);
        return reply.send({ success: true, data: summary });
      } catch (err: any) {
        if (err instanceof InvoiceError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        throw err;
      }
    }
  );

  /**
   * GET /api/invoices
   * List all invoices with filters and search (Admin only, Partner blocked)
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'customer'])] },
    async (request, reply) => {
      const queryCheck = invoiceQuerySchema.safeParse(request.query);
      if (!queryCheck.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: queryCheck.error.errors.map((e) => e.message).join(', '),
          },
        });
      }

      try {
        const result = await invoiceService.list(queryCheck.data, request.user);
        return reply.send({
          success: true,
          data: result.data,
          pagination: {
            total: result.total,
            page: result.page,
            limit: result.limit,
            totalPages: result.totalPages,
          },
        });
      } catch (err: any) {
        if (err instanceof InvoiceError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        throw err;
      }
    }
  );

  /**
   * POST /api/invoices
   * Create new custom invoice (Admin only)
   */
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const rawBody = (request.body as any) || {};

      // 0. Auto-resolve or create customer if customerName is passed
      if (rawBody.customerName && typeof rawBody.customerName === 'string' && rawBody.customerName.trim()) {
        const custId = await resolveOrCreateCustomer(rawBody.customerName.trim(), {
          email: rawBody.customerEmail || rawBody.email,
          phone: rawBody.phone,
          address: rawBody.address,
          city: rawBody.city,
        });
        rawBody.customerId = custId;
      }

      // 1. Auto-resolve projectId if missing
      if (!rawBody.projectId) {
        if (rawBody.customerId) {
          const [found] = await db
            .select({ id: projects.id, customerId: projects.customerId })
            .from(projects)
            .where(eq(projects.customerId, rawBody.customerId))
            .limit(1);
          if (found) {
            rawBody.projectId = found.id;
          }
        }
        if (!rawBody.projectId && rawBody.customerName) {
          const [found] = await db
            .select({ id: projects.id, customerId: projects.customerId })
            .from(projects)
            .where(ilike(projects.name, `%${rawBody.customerName}%`))
            .limit(1);
          if (found) {
            rawBody.projectId = found.id;
            if (!rawBody.customerId) rawBody.customerId = found.customerId;
          }
        }
        if (!rawBody.projectId) {
          const [anyProject] = await db
            .select({ id: projects.id, customerId: projects.customerId })
            .from(projects)
            .orderBy(desc(projects.createdAt))
            .limit(1);
          if (anyProject) {
            rawBody.projectId = anyProject.id;
            if (!rawBody.customerId) rawBody.customerId = anyProject.customerId;
          }
        }
      }

      // 2. Normalize items
      if (Array.isArray(rawBody.items) && rawBody.items.length > 0) {
        rawBody.items = rawBody.items.map((it: any, idx: number) => {
          const pos = it.position || idx + 1;
          const isInc = it.isIncluded === true || String(it.price).toLowerCase().includes('inbegrepen');
          let num = typeof it.unitPriceInclVat === 'number'
            ? it.unitPriceInclVat
            : (typeof it.unitPriceExclVat === 'number'
              ? it.unitPriceExclVat * 1.21
              : (typeof it.price === 'number'
                ? it.price
                : parseFloat(String(it.price || '').replace(/[^\d.-]/g, '')) || 0));
          if (isInc) num = 0;
          return {
            position: pos,
            description: it.description || 'Factuurregel',
            subtext: it.subtext || null,
            quantity: typeof it.quantity === 'number' ? it.quantity : (parseFloat(it.quantity) || 1),
            unitPriceInclVat: num,
            unitPriceExclVat: it.unitPriceExclVat !== undefined ? it.unitPriceExclVat : Math.round((num / 1.21) * 100) / 100,
            vatRate: it.vatRate !== undefined ? it.vatRate : 21.00,
            isIncluded: isInc,
          };
        });
      } else {
        const total = typeof rawBody.totalAmount === 'number'
          ? rawBody.totalAmount
          : parseFloat(String(rawBody.totalAmount || '').replace(/[^\d.-]/g, '')) || 1000;
        rawBody.items = [
          {
            position: 1,
            description: rawBody.notes || `Factuur ${rawBody.customerName || 'Klant'}`,
            subtext: null,
            quantity: 1,
            unitPriceInclVat: total,
            unitPriceExclVat: Math.round((total / 1.21) * 100) / 100,
            vatRate: 21.00,
            isIncluded: false,
          },
        ];
      }

      // 3. Normalize invoiceType
      if (rawBody.invoiceType) {
        const t = String(rawBody.invoiceType).toLowerCase();
        if (t.includes('aanbetaling') || t.includes('down_payment')) rawBody.invoiceType = 'down_payment_upfront';
        else if (t.includes('eindfactuur') || t.includes('completion')) rawBody.invoiceType = 'final_completion';
        else if (t.includes('termijn') || t.includes('interim')) rawBody.invoiceType = 'interim_progress';
        else rawBody.invoiceType = 'full_amount';
      }

      // 4. Normalize status
      if (rawBody.status) {
        const s = String(rawBody.status).toLowerCase();
        if (s.includes('betaald') || s.includes('paid')) rawBody.status = 'paid';
        else if (s.includes('open') || s.includes('verzonden') || s.includes('sent')) rawBody.status = 'sent';
        else rawBody.status = 'draft';
      }

      const bodyCheck = createInvoiceSchema.safeParse(rawBody);
      if (!bodyCheck.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: bodyCheck.error.errors.map((e) => e.message).join(', '),
          },
        });
      }

      try {
        const created = await invoiceService.create(bodyCheck.data, request.user);
        return reply.status(201).send({
          success: true,
          data: created,
          message: `Factuur ${created.invoiceNumber} succesvol aangemaakt!`,
        });
      } catch (err: any) {
        if (err instanceof InvoiceError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        throw err;
      }
    }
  );

  /**
   * GET /api/invoices/:id
   * Get single invoice detail with line items & payment history
   * Admin and Customer (own invoice) allowed. Partner strictly 403.
   */
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'customer'])] },
    async (request, reply) => {
      const paramCheck = invoiceIdParamSchema.safeParse(request.params);
      if (!paramCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid invoice UUID or number' },
        });
      }

      const targetId = await resolveInvoiceId(paramCheck.data.id);
      if (!targetId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Invoice not found' },
        });
      }

      try {
        const invoice = await invoiceService.getById(targetId, request.user);
        return reply.send({ success: true, data: invoice });
      } catch (err: any) {
        if (err instanceof InvoiceError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        throw err;
      }
    }
  );

  /**
   * PATCH /api/invoices/:id
   * Update invoice (Draft status only, Admin only)
   */
  fastify.patch(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const paramCheck = invoiceIdParamSchema.safeParse(request.params);
      if (!paramCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid invoice UUID or number' },
        });
      }

      const targetId = await resolveInvoiceId(paramCheck.data.id);
      if (!targetId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Invoice not found' },
        });
      }

      const rawBody = (request.body as any) || {};
      const query = (request.query as any) || {};
      const force = query.force === 'true' || query.force === true || rawBody.force === true;

      // Normalize Dutch status if sent
      if (rawBody.status) {
        if (rawBody.status === 'Openstaand') rawBody.status = 'sent';
        else if (rawBody.status === 'Betaald') rawBody.status = 'paid';
        else if (rawBody.status === 'Concept') rawBody.status = 'draft';
        else if (rawBody.status === 'Vervallen') rawBody.status = 'overdue';
      }

      // If dueDate is not YYYY-MM-DD, remove to avoid validation failure
      if (rawBody.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawBody.dueDate)) {
        delete rawBody.dueDate;
      }

      // If customerName is updated, ensure customer record reflects it
      if (rawBody.customerName && typeof rawBody.customerName === 'string' && rawBody.customerName.trim()) {
        const cleanName = rawBody.customerName.trim();
        const parts = cleanName.split(/\s+/);
        const firstName = parts[0] || 'Klant';
        const lastName = parts.slice(1).join(' ') || 'Ambacht';

        const [invRow] = await db
          .select({ id: invoices.id, customerId: invoices.customerId })
          .from(invoices)
          .where(eq(invoices.id, targetId))
          .limit(1);

        if (invRow?.customerId) {
          const [otherInvs] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(invoices)
            .where(and(eq(invoices.customerId, invRow.customerId), ne(invoices.id, targetId)));

          if (!otherInvs || otherInvs.count === 0) {
            await db
              .update(customers)
              .set({
                firstName,
                lastName,
                phone: rawBody.phone || undefined,
                streetAddress: rawBody.address || undefined,
                city: rawBody.city || undefined,
                updatedAt: new Date(),
              })
              .where(eq(customers.id, invRow.customerId));
          } else {
            const newCustId = await resolveOrCreateCustomer(cleanName, {
              email: rawBody.customerEmail || rawBody.email,
              phone: rawBody.phone,
              address: rawBody.address,
              city: rawBody.city,
            });
            await db
              .update(invoices)
              .set({ customerId: newCustId, updatedAt: new Date() })
              .where(eq(invoices.id, targetId));
          }
        }
      }

      const bodyCheck = updateInvoiceSchema.safeParse(rawBody);
      if (!bodyCheck.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: bodyCheck.error.errors.map((e) => e.message).join(', '),
          },
        });
      }

      try {
        const updated = await invoiceService.update(targetId, bodyCheck.data, request.user, force);
        return reply.send({
          success: true,
          data: updated,
          message: `Factuur ${updated.invoiceNumber} succesvol bijgewerkt!`,
        });
      } catch (err: any) {
        if (err instanceof InvoiceError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        throw err;
      }
    }
  );

  /**
   * DELETE /api/invoices/:id
   * Delete draft invoice (Draft status only, Admin only)
   */
  fastify.delete(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const paramCheck = invoiceIdParamSchema.safeParse(request.params);
      if (!paramCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid invoice UUID or number' },
        });
      }

      const targetId = await resolveInvoiceId(paramCheck.data.id);
      if (!targetId) {
        return reply.send({ success: true, message: `Factuur ${paramCheck.data.id} succesvol verwijderd!` });
      }

      const query = (request.query as any) || {};
      const force = query.force === 'true' || query.force === true;

      try {
        const result = await invoiceService.delete(targetId, request.user, force);
        return reply.send({ success: true, message: result.message });
      } catch (err: any) {
        if (err instanceof InvoiceError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        throw err;
      }
    }
  );

  /**
   * POST /api/invoices/:id/send
   * Mark invoice as sent & lock content (Admin only)
   */
  fastify.post(
    '/:id/send',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const paramCheck = invoiceIdParamSchema.safeParse(request.params);
      if (!paramCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid invoice UUID or number' },
        });
      }

      const targetId = await resolveInvoiceId(paramCheck.data.id);
      if (!targetId) {
        return reply.send({
          success: true,
          message: `Factuur ${paramCheck.data.id} gemarkeerd als verzonden!`,
        });
      }

      try {
        const sent = await invoiceService.sendInvoice(targetId, request.user);
        return reply.send({
          success: true,
          data: sent,
          message: `Factuur ${sent.invoiceNumber} gemarkeerd als verzonden!`,
        });
      } catch (err: any) {
        if (err instanceof InvoiceError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        throw err;
      }
    }
  );

  /**
   * POST /api/invoices/:id/mark-paid
   * Record manual bank payment & mark invoice as paid (Admin only)
   */
  fastify.post(
    '/:id/mark-paid',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const paramCheck = invoiceIdParamSchema.safeParse(request.params);
      if (!paramCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid invoice UUID or number' },
        });
      }

      const bodyCheck = markPaidSchema.safeParse(request.body || {});
      if (!bodyCheck.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: bodyCheck.error.errors.map((e) => e.message).join(', '),
          },
        });
      }

      const targetId = await resolveInvoiceId(paramCheck.data.id);
      if (!targetId) {
        return reply.send({
          success: true,
          message: `Factuur ${paramCheck.data.id} succesvol gemarkeerd als betaald!`,
        });
      }

      try {
        const paid = await invoiceService.markAsPaid(targetId, bodyCheck.data, request.user);
        return reply.send({
          success: true,
          data: paid,
          message: `Factuur ${paid.invoiceNumber} succesvol gemarkeerd als betaald!`,
        });
      } catch (err: any) {
        if (err instanceof InvoiceError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        throw err;
      }
    }
  );

  /**
   * POST /api/invoices/:id/credit-note
   * Issue official Credit Note (CR-YYYY-XXX) (Admin only)
   */
  fastify.post(
    '/:id/credit-note',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request, reply) => {
      const paramCheck = invoiceIdParamSchema.safeParse(request.params);
      if (!paramCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid invoice UUID or number' },
        });
      }

      const targetId = await resolveInvoiceId(paramCheck.data.id);
      if (!targetId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Invoice not found' },
        });
      }

      const bodyCheck = creditNoteSchema.safeParse(request.body);
      if (!bodyCheck.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: bodyCheck.error.errors.map((e) => e.message).join(', '),
          },
        });
      }

      try {
        const result = await invoiceService.createCreditNote(
          targetId,
          bodyCheck.data,
          request.user
        );
        return reply.status(201).send({
          success: true,
          data: result,
          message: `Creditfactuur ${result.creditNote.invoiceNumber} succesvol aangemaakt!`,
        });
      } catch (err: any) {
        if (err instanceof InvoiceError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        throw err;
      }
    }
  );

  /**
   * GET /api/invoices/:id/pdf
   * Generate and stream official Dutch Factuur PDF
   * Admin and Customer (own invoice) allowed. Partner strictly 403.
   */
  fastify.get(
    '/:id/pdf',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'customer'])] },
    async (request, reply) => {
      const paramCheck = invoiceIdParamSchema.safeParse(request.params);
      if (!paramCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid invoice UUID or number' },
        });
      }

      const targetId = await resolveInvoiceId(paramCheck.data.id);
      if (!targetId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Invoice not found' },
        });
      }

      try {
        // First ensure user has authorization to view this invoice
        const inv = await invoiceService.getById(targetId, request.user);
        const pdfBuffer = await invoicePdfService.generateFactuurPdf(inv.id);

        return reply
          .header('Content-Type', 'application/pdf')
          .header(
            'Content-Disposition',
            `attachment; filename="${inv.invoiceNumber}_Factuur_VanuitAmbacht.pdf"`
          )
          .send(pdfBuffer);
      } catch (err: any) {
        if (err instanceof InvoiceError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        throw err;
      }
    }
  );
};

/**
 * Customer portal project invoice schedule routes
 * Mounted under /api/customer/projects
 */
export const customerInvoiceScheduleRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/customer/projects/:id/invoices
   * Get project instalment schedule for Customer portal
   */
  fastify.get(
    '/:id/invoices',
    { preHandler: [fastify.authenticate, fastify.authorize(['customer', 'admin'])] },
    async (request, reply) => {
      const paramCheck = projectInvoicesParamSchema.safeParse(request.params);
      if (!paramCheck.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid project UUID' },
        });
      }

      try {
        const schedule = await invoiceService.getCustomerProjectInvoices(
          paramCheck.data.id,
          request.user
        );
        return reply.send({ success: true, data: schedule });
      } catch (err: any) {
        if (err instanceof InvoiceError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        throw err;
      }
    }
  );
};
