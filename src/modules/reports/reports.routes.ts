import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { reportsService } from './reports.service.js';

const vatQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2035).default(new Date().getFullYear()),
  quarter: z.string().min(2).max(10).default('Q4'),
});

const fileVatSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2035).default(new Date().getFullYear()),
  quarter: z.string().min(2).max(10).default('Q4'),
});

const profitLossQuerySchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
});

const exportCsvQuerySchema = z.object({
  type: z.enum(['finance', 'funnel', 'profit-loss']).default('finance'),
});

export const reportsRoutes: FastifyPluginAsync = async (fastify) => {
  // All reports endpoints strictly require Admin authentication
  const adminGuard = {
    preHandler: [fastify.authenticate, fastify.authorize(['admin'])],
  };

  /**
   * 1. GET /api/reports/funnel
   * Lead conversion funnel metrics
   */
  fastify.get('/funnel', adminGuard, async (_request, reply) => {
    try {
      const data = await reportsService.getFunnel();
      return reply.send({ success: true, data });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve funnel metrics' },
      });
    }
  });

  /**
   * 2. GET /api/reports/finance-stats
   * Financial overview KPIs
   */
  fastify.get('/finance-stats', adminGuard, async (_request, reply) => {
    try {
      const data = await reportsService.getFinanceStats();
      return reply.send({ success: true, data });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve finance stats' },
      });
    }
  });

  /**
   * 3. GET /api/reports/taxes
   * Dutch VAT report (Rubrieken 1a, 1b, 5b)
   */
  fastify.get('/taxes', adminGuard, async (request, reply) => {
    const parse = vatQuerySchema.safeParse(request.query);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message },
      });
    }

    try {
      const data = await reportsService.getTaxes(parse.data.year, parse.data.quarter);
      return reply.send({ success: true, data });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve VAT report' },
      });
    }
  });

  /**
   * 4. POST /api/reports/taxes/file
   * Submit and persist formal VAT return
   */
  fastify.post('/taxes/file', adminGuard, async (request, reply) => {
    const parse = fileVatSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message },
      });
    }

    try {
      const result = await reportsService.fileVatReturn(
        parse.data.year,
        parse.data.quarter,
        request.user.sub
      );
      return reply.status(result.alreadyFiled ? 200 : 201).send({
        success: true,
        data: result.filing,
        alreadyFiled: result.alreadyFiled,
        message: result.message,
      });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(400).send({
        success: false,
        error: { code: 'VAT_FILING_FAILED', message: err.message },
      });
    }
  });

  /**
   * 5. GET /api/reports/taxes/receipt-pdf
   * PDF receipt stream for VAT filing
   */
  fastify.get('/taxes/receipt-pdf', adminGuard, async (request, reply) => {
    const query = request.query as any;
    const filingNumber = query.filingNumber || 'BTW-2026-Q1';

    try {
      const pdfBuffer = await reportsService.generateVatReceiptPdf(filingNumber);
      return reply
        .type('application/pdf')
        .header('Content-Disposition', `attachment; filename="${filingNumber}.pdf"`)
        .send(pdfBuffer);
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to generate VAT receipt PDF' },
      });
    }
  });

  /**
   * 6. GET /api/reports/profit-loss
   * Live project-level P&L and gross margins
   */
  fastify.get('/profit-loss', adminGuard, async (request, reply) => {
    const parse = profitLossQuerySchema.safeParse(request.query);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message },
      });
    }

    try {
      const data = await reportsService.getProfitLoss(parse.data.category, parse.data.search);
      return reply.send({ success: true, data });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to generate P&L report' },
      });
    }
  });

  /**
   * 7. GET /api/reports/export/csv
   * Stream RFC 4180 CSV
   */
  fastify.get('/export/csv', adminGuard, async (request, reply) => {
    const parse = exportCsvQuerySchema.safeParse(request.query);
    const type = parse.success ? parse.data.type : 'finance';

    try {
      const csvData = await reportsService.exportCsv(type);
      const filename = `Vanuit_Ambacht_${type}_${new Date().toISOString().split('T')[0]}.csv`;
      return reply
        .type('text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(csvData);
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to export CSV' },
      });
    }
  });

  /**
   * 8. GET /api/reports/export/pdf
   * Server-side Executive Business Report PDF
   */
  fastify.get('/export/pdf', adminGuard, async (_request, reply) => {
    try {
      const pdfBuffer = await reportsService.generateReportsPdf();
      const filename = `Vanuit-Ambacht-Report-${new Date().toISOString().split('T')[0]}.pdf`;
      return reply
        .type('application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(pdfBuffer);
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to generate report PDF' },
      });
    }
  });
};
