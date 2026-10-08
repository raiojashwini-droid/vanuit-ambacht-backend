import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { authPlugin } from './plugins/auth.plugin.js';
import { authRoutes } from './routes/auth.routes.js';
import { customerRoutes } from './modules/customers/customer.routes.js';
import { partnerRoutes } from './modules/partners/partner.routes.js';
import { leadRoutes } from './modules/leads/lead.routes.js';
import { partnerRequestRoutes } from './modules/partner-requests/partner-request.routes.js';
import { documentRoutes } from './modules/documents/document.routes.js';
import { quoteRoutes } from './modules/quotes/quote.routes.js';
import { publicOfferteRoutes } from './modules/quotes/public-offerte.routes.js';
import { projectRoutes } from './modules/projects/project.routes.js';
import { partnerProjectRoutes } from './modules/projects/partner-project.routes.js';
import { customerProjectRoutes } from './modules/projects/customer-project.routes.js';
import { planningRoutes } from './modules/planning/planning.routes.js';
import { invoiceRoutes, customerInvoiceScheduleRoutes } from './modules/invoices/invoice.routes.js';
import { bankRoutes } from './modules/bank/bank.routes.js';
import { paymentRoutes } from './modules/payments/payment.routes.js';
import { accountingRoutes } from './modules/accounting/accounting.routes.js';
import { taskRoutes } from './modules/tasks/task.routes.js';
import { conversationRoutes } from './modules/conversations/conversation.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { photoRoutes } from './modules/projects/photo.routes.js';
import { reportsRoutes } from './modules/reports/reports.routes.js';
import { partnerDashboardRoutes } from './modules/partner/partner-dashboard.routes.js';
import { profileRoutes } from './modules/users/profile.routes.js';
dotenv.config();
const server = Fastify({
    logger: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
});
// Configure CORS with credentials support for HttpOnly cookies
const allowedOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
await server.register(cors, {
    origin: (origin, cb) => {
        // Allow requests with no origin (like mobile apps, curl, postman) or matching origin
        if (!origin || origin === allowedOrigin || origin.startsWith('http://localhost:')) {
            cb(null, true);
            return;
        }
        cb(new Error('CORS Not Allowed'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-impersonate-role', 'x-impersonate-id'],
});
// Register Authentication & Cookie Plugin
await server.register(authPlugin);
// Health Check
server.get('/health', async () => {
    return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'vanuit-ambacht-backend',
        database: 'vanuit ambacht',
    };
});
// Register Domain Routes
await server.register(authRoutes, { prefix: '/api/auth' });
await server.register(customerRoutes, { prefix: '/api/customers' });
await server.register(partnerRoutes, { prefix: '/api/partners' });
await server.register(leadRoutes, { prefix: '/api/leads' });
await server.register(partnerRequestRoutes, { prefix: '/api/partner-requests' });
await server.register(documentRoutes, { prefix: '/api/documents' });
await server.register(quoteRoutes, { prefix: '/api/quotes' });
await server.register(publicOfferteRoutes, { prefix: '/api/offerte' });
await server.register(projectRoutes, { prefix: '/api/projects' });
await server.register(partnerProjectRoutes, { prefix: '/api/partner/projects' });
await server.register(customerProjectRoutes, { prefix: '/api/customer/projects' });
await server.register(planningRoutes, { prefix: '/api/planning' });
await server.register(invoiceRoutes, { prefix: '/api/invoices' });
await server.register(customerInvoiceScheduleRoutes, { prefix: '/api/customer/projects' });
await server.register(bankRoutes, { prefix: '/api/bank' });
await server.register(paymentRoutes, { prefix: '/api/payments' });
await server.register(accountingRoutes, { prefix: '/api/accounting' });
await server.register(taskRoutes, { prefix: '/api/tasks' });
await server.register(conversationRoutes, { prefix: '/api/conversations' });
await server.register(dashboardRoutes, { prefix: '/api/dashboard' });
await server.register(settingsRoutes, { prefix: '/api/settings' });
await server.register(photoRoutes, { prefix: '/api/photos' });
await server.register(reportsRoutes, { prefix: '/api/reports' });
await server.register(partnerDashboardRoutes, { prefix: '/api/partner' });
await server.register(profileRoutes, { prefix: '/api/users/profile' });
const PORT = Number(process.env.PORT) || 3001;
export async function start() {
    try {
        await server.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`🚀 Fastify backend server running at http://localhost:${PORT}`);
    }
    catch (err) {
        server.log.error(err);
        process.exit(1);
    }
}
if (process.env.NODE_ENV !== 'test') {
    start();
}
export default server;
