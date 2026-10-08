import { z } from 'zod';
import { accountingService, AccountingError } from './accounting.service.js';
import { createChartOfAccountSchema, updateChartOfAccountSchema, createJournalEntrySchema, reverseJournalEntrySchema, listJournalEntriesQuerySchema, generalLedgerQuerySchema, trialBalanceQuerySchema, vatReportQuerySchema, profitLossQuerySchema, balanceSheetQuerySchema, updateFiscalLockSchema, } from './accounting.schema.js';
const journalEntryIdParamSchema = z.object({
    id: z.string().uuid('Invalid journal entry UUID'),
});
const accountIdParamSchema = z.object({
    id: z.string().uuid('Invalid account UUID'),
});
export const accountingRoutes = async (fastify) => {
    // Pre-handler: Strictly Admin Only for all accounting endpoints
    fastify.addHook('preHandler', fastify.authenticate);
    fastify.addHook('preHandler', fastify.authorize(['admin']));
    /**
     * GET /api/accounting/accounts
     * List all Chart of Accounts
     */
    fastify.get('/accounts', async (_request, reply) => {
        try {
            const accounts = await accountingService.listAccounts();
            return reply.send({ success: true, data: accounts });
        }
        catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve accounts' },
            });
        }
    });
    /**
     * POST /api/accounting/accounts
     * Create new Chart of Account
     */
    fastify.post('/accounts', async (request, reply) => {
        const parse = createChartOfAccountSchema.safeParse(request.body);
        if (!parse.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message },
            });
        }
        try {
            const created = await accountingService.createAccount(parse.data);
            return reply.status(201).send({ success: true, data: created });
        }
        catch (err) {
            if (err instanceof AccountingError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to create account' },
            });
        }
    });
    /**
     * PUT /api/accounting/accounts/:id
     * Update Chart of Account
     */
    fastify.put('/accounts/:id', async (request, reply) => {
        const paramCheck = accountIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid account UUID' },
            });
        }
        const bodyCheck = updateChartOfAccountSchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
            });
        }
        try {
            const updated = await accountingService.updateAccount(paramCheck.data.id, bodyCheck.data);
            return reply.send({ success: true, data: updated });
        }
        catch (err) {
            if (err instanceof AccountingError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to update account' },
            });
        }
    });
    /**
     * GET /api/accounting/journal-entries
     * List paginated journal entries
     */
    fastify.get('/journal-entries', async (request, reply) => {
        const parse = listJournalEntriesQuerySchema.safeParse(request.query);
        if (!parse.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message },
            });
        }
        try {
            const result = await accountingService.listJournalEntries(parse.data);
            return reply.send({ success: true, data: result });
        }
        catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to list journal entries' },
            });
        }
    });
    /**
     * POST /api/accounting/journal-entries
     * Create and post manual double-entry journal entry
     */
    fastify.post('/journal-entries', async (request, reply) => {
        const parse = createJournalEntrySchema.safeParse(request.body);
        if (!parse.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message },
            });
        }
        try {
            const entry = await accountingService.createJournalEntry(parse.data, request.user.sub);
            return reply.status(201).send({ success: true, data: entry });
        }
        catch (err) {
            if (err instanceof AccountingError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to create journal entry' },
            });
        }
    });
    /**
     * GET /api/accounting/journal-entries/:id
     * Get single journal entry detail
     */
    fastify.get('/journal-entries/:id', async (request, reply) => {
        const paramCheck = journalEntryIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid journal entry UUID' },
            });
        }
        try {
            const entry = await accountingService.getEntryById(paramCheck.data.id);
            return reply.send({ success: true, data: entry });
        }
        catch (err) {
            if (err instanceof AccountingError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch journal entry' },
            });
        }
    });
    /**
     * POST /api/accounting/journal-entries/:id/post
     * Post a draft journal entry
     */
    fastify.post('/journal-entries/:id/post', async (request, reply) => {
        const paramCheck = journalEntryIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid journal entry UUID' },
            });
        }
        try {
            const posted = await accountingService.postDraftJournalEntry(paramCheck.data.id, request.user.sub);
            return reply.send({
                success: true,
                data: posted,
                message: 'Draft journal entry successfully posted.',
            });
        }
        catch (err) {
            if (err instanceof AccountingError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to post draft journal entry' },
            });
        }
    });
    /**
     * POST /api/accounting/journal-entries/:id/reverse
     * Reverse an existing posted journal entry
     */
    fastify.post('/journal-entries/:id/reverse', async (request, reply) => {
        const paramCheck = journalEntryIdParamSchema.safeParse(request.params);
        if (!paramCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'INVALID_ID', message: 'Invalid journal entry UUID' },
            });
        }
        const bodyCheck = reverseJournalEntrySchema.safeParse(request.body);
        if (!bodyCheck.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: bodyCheck.error.issues[0]?.message },
            });
        }
        try {
            const result = await accountingService.reverseJournalEntry(paramCheck.data.id, bodyCheck.data.reason, bodyCheck.data.reversalDate, request.user.sub);
            return reply.send({
                success: true,
                data: result,
                message: 'Journal entry successfully reversed with offsetting entry.',
            });
        }
        catch (err) {
            if (err instanceof AccountingError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to reverse journal entry' },
            });
        }
    });
    /**
     * GET /api/accounting/general-ledger
     * General Ledger (Grootboek) report
     */
    fastify.get('/general-ledger', async (request, reply) => {
        const parse = generalLedgerQuerySchema.safeParse(request.query);
        if (!parse.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message },
            });
        }
        try {
            const ledger = await accountingService.getGeneralLedger(parse.data);
            return reply.send({ success: true, data: ledger });
        }
        catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to generate general ledger' },
            });
        }
    });
    /**
     * GET /api/accounting/trial-balance
     * Trial Balance (Saldibalans) report
     */
    fastify.get('/trial-balance', async (request, reply) => {
        const parse = trialBalanceQuerySchema.safeParse(request.query);
        if (!parse.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message },
            });
        }
        try {
            const report = await accountingService.getTrialBalance(parse.data.asOfDate);
            return reply.send({ success: true, data: report });
        }
        catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to generate trial balance' },
            });
        }
    });
    /**
     * GET /api/accounting/vat-report
     * Dutch VAT report (BTW Aangifte)
     */
    fastify.get('/vat-report', async (request, reply) => {
        const parse = vatReportQuerySchema.safeParse(request.query);
        if (!parse.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message },
            });
        }
        try {
            const report = await accountingService.getVatReport(parse.data.year, parse.data.quarter);
            return reply.send({ success: true, data: report });
        }
        catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to generate VAT report' },
            });
        }
    });
    /**
     * GET /api/accounting/profit-loss
     * Profit & Loss (Winst & Verlies) report
     */
    fastify.get('/profit-loss', async (request, reply) => {
        const parse = profitLossQuerySchema.safeParse(request.query);
        if (!parse.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message },
            });
        }
        try {
            const report = await accountingService.getProfitLoss(parse.data.year, parse.data.startDate, parse.data.endDate);
            return reply.send({ success: true, data: report });
        }
        catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to generate profit and loss report' },
            });
        }
    });
    /**
     * GET /api/accounting/balance-sheet
     * Balance Sheet (Balans) report
     */
    fastify.get('/balance-sheet', async (request, reply) => {
        const parse = balanceSheetQuerySchema.safeParse(request.query);
        if (!parse.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message },
            });
        }
        try {
            const report = await accountingService.getBalanceSheet(parse.data.asOfDate);
            return reply.send({ success: true, data: report });
        }
        catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to generate balance sheet' },
            });
        }
    });
    /**
     * GET /api/accounting/fiscal-lock
     * Get fiscal lock settings
     */
    fastify.get('/fiscal-lock', async (_request, reply) => {
        try {
            const settings = await accountingService.getFiscalLock();
            return reply.send({ success: true, data: settings });
        }
        catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to get fiscal lock' },
            });
        }
    });
    /**
     * PUT /api/accounting/fiscal-lock
     * Update fiscal lock date (Admin only)
     */
    fastify.put('/fiscal-lock', async (request, reply) => {
        const parse = updateFiscalLockSchema.safeParse(request.body);
        if (!parse.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message },
            });
        }
        try {
            const updated = await accountingService.updateFiscalLock(parse.data.fiscalLockDate);
            return reply.send({
                success: true,
                data: updated,
                message: parse.data.fiscalLockDate
                    ? `Fiscal lock established up to ${parse.data.fiscalLockDate}`
                    : 'Fiscal lock removed',
            });
        }
        catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to update fiscal lock' },
            });
        }
    });
};
