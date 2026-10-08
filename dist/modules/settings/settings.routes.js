import { settingsService, SettingsError } from './settings.service.js';
import { updateCompanySettingsSchema, configSectionParamSchema, createSystemUserSchema, updateUserStatusSchema, updateUserRoleSchema, } from './settings.schema.js';
import { z } from 'zod';
export const settingsRoutes = async (fastify) => {
    // Admin Guard for sensitive mutation & user management routes
    const adminGuard = { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] };
    // Read Guard for general company & platform breakdown configs
    const readCompanyGuard = { preHandler: [fastify.authenticate, fastify.authorize(['admin', 'partner', 'customer'])] };
    /**
     * 1. GET /api/settings/company
     * Fetch company profile, financial configurations, VAT rates, numbering prefixes, and dynamic JSON configs
     */
    fastify.get('/company', readCompanyGuard, async (request, reply) => {
        try {
            const settings = await settingsService.getCompanySettings();
            return reply.send({ success: true, data: settings });
        }
        catch (err) {
            if (err instanceof SettingsError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * 2. PUT /api/settings/company
     * Update company details, VAT rates, numbering prefixes, or terms
     */
    fastify.put('/company', adminGuard, async (request, reply) => {
        try {
            const input = updateCompanySettingsSchema.parse(request.body);
            const updated = await settingsService.updateCompanySettings(input);
            return reply.send({
                success: true,
                message: 'Company settings updated successfully',
                data: updated,
            });
        }
        catch (err) {
            if (err instanceof z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: { code: 'VALIDATION_FAILED', message: 'Invalid input', details: err.errors },
                });
            }
            if (err instanceof SettingsError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * 3. PATCH /api/settings/config/:section
     * Granular update of dynamic configuration sections
     */
    fastify.patch('/config/:section', adminGuard, async (request, reply) => {
        try {
            const { section } = configSectionParamSchema.parse(request.params);
            const updated = await settingsService.updateSectionConfig(section, request.body);
            return reply.send({
                success: true,
                message: `Configuration section "${section}" updated successfully`,
                data: updated,
            });
        }
        catch (err) {
            if (err instanceof z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: { code: 'VALIDATION_FAILED', message: 'Invalid section or payload', details: err.errors },
                });
            }
            if (err instanceof SettingsError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * 4. GET /api/settings/users
     * List all registered system users
     */
    fastify.get('/users', adminGuard, async (request, reply) => {
        try {
            const users = await settingsService.listUsers();
            return reply.send({ success: true, data: users });
        }
        catch (err) {
            if (err instanceof SettingsError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * 5. POST /api/settings/users
     * Invite or create a new system user
     */
    fastify.post('/users', adminGuard, async (request, reply) => {
        try {
            const input = createSystemUserSchema.parse(request.body);
            const newUser = await settingsService.createUser(input);
            return reply.status(201).send({
                success: true,
                message: `User "${newUser.fullName}" created successfully`,
                data: newUser,
            });
        }
        catch (err) {
            if (err instanceof z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: { code: 'VALIDATION_FAILED', message: 'Invalid user payload', details: err.errors },
                });
            }
            if (err instanceof SettingsError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * 6. PATCH /api/settings/users/:id/status
     * Toggle user active/inactive status
     */
    fastify.patch('/users/:id/status', adminGuard, async (request, reply) => {
        try {
            const { id } = request.params;
            const { isActive } = updateUserStatusSchema.parse(request.body);
            const currentAdminId = request.user.sub;
            const updated = await settingsService.updateUserStatus(id, isActive, currentAdminId);
            return reply.send({
                success: true,
                message: `User status changed to ${isActive ? 'Active' : 'Inactive'}`,
                data: updated,
            });
        }
        catch (err) {
            if (err instanceof z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: { code: 'VALIDATION_FAILED', message: 'Invalid status payload', details: err.errors },
                });
            }
            if (err instanceof SettingsError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
    /**
     * 7. PATCH /api/settings/users/:id/role
     * Update user role
     */
    fastify.patch('/users/:id/role', adminGuard, async (request, reply) => {
        try {
            const { id } = request.params;
            const { role } = updateUserRoleSchema.parse(request.body);
            const currentAdminId = request.user.sub;
            const updated = await settingsService.updateUserRole(id, role, currentAdminId);
            return reply.send({
                success: true,
                message: `User role changed to ${role.toUpperCase()}`,
                data: updated,
            });
        }
        catch (err) {
            if (err instanceof z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: { code: 'VALIDATION_FAILED', message: 'Invalid role payload', details: err.errors },
                });
            }
            if (err instanceof SettingsError) {
                return reply.status(err.statusCode).send({
                    success: false,
                    error: { code: err.code, message: err.message },
                });
            }
            throw err;
        }
    });
};
