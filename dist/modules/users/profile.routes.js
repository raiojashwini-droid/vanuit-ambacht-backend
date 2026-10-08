import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { storageService } from '../../services/storage.service.js';
const updateProfileSchema = z.object({
    fullName: z.string().min(1).max(150).optional(),
    phone: z.string().max(50).optional(),
    language: z.string().min(2).max(10).optional(),
    timezone: z.string().min(2).max(50).optional(),
});
const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(6, 'New password must be at least 6 characters long'),
});
const avatarUploadSchema = z.object({
    fileBase64: z.string().min(1, 'File base64 is required'),
    fileName: z.string().min(1, 'File name is required'),
    mimeType: z.string().optional(),
});
export const profileRoutes = async (fastify) => {
    // All profile endpoints require valid authentication for the requesting user
    fastify.addHook('preHandler', fastify.authenticate);
    /**
     * 1. GET /api/users/profile
     * Return authenticated user profile (excluding passwordHash)
     */
    fastify.get('/', async (request, reply) => {
        try {
            const userId = request.user.sub;
            const userRows = await db
                .select({
                id: users.id,
                email: users.email,
                role: users.role,
                fullName: users.fullName,
                phone: users.phone,
                avatarUrl: users.avatarUrl,
                language: users.language,
                timezone: users.timezone,
                isActive: users.isActive,
                createdAt: users.createdAt,
                updatedAt: users.updatedAt,
            })
                .from(users)
                .where(eq(users.id, userId))
                .limit(1);
            if (userRows.length === 0) {
                return reply.status(404).send({
                    success: false,
                    error: { code: 'USER_NOT_FOUND', message: 'User profile not found' },
                });
            }
            return reply.send({
                success: true,
                data: userRows[0],
            });
        }
        catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve profile' },
            });
        }
    });
    /**
     * 2. PATCH /api/users/profile
     * Update personal info (name, phone, language, timezone)
     */
    fastify.patch('/', async (request, reply) => {
        const parse = updateProfileSchema.safeParse(request.body);
        if (!parse.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message },
            });
        }
        try {
            const userId = request.user.sub;
            const updates = { updatedAt: new Date() };
            if (parse.data.fullName !== undefined)
                updates.fullName = parse.data.fullName;
            if (parse.data.phone !== undefined)
                updates.phone = parse.data.phone;
            if (parse.data.language !== undefined)
                updates.language = parse.data.language;
            if (parse.data.timezone !== undefined)
                updates.timezone = parse.data.timezone;
            const updated = await db
                .update(users)
                .set(updates)
                .where(eq(users.id, userId))
                .returning({
                id: users.id,
                email: users.email,
                role: users.role,
                fullName: users.fullName,
                phone: users.phone,
                avatarUrl: users.avatarUrl,
                language: users.language,
                timezone: users.timezone,
                isActive: users.isActive,
                updatedAt: users.updatedAt,
            });
            return reply.send({
                success: true,
                data: updated[0],
                message: 'Profielgegevens succesvol bijgewerkt!',
            });
        }
        catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to update profile' },
            });
        }
    });
    /**
     * 3. PATCH /api/users/profile/password
     * Change user password (verifies currentPassword)
     */
    fastify.patch('/password', async (request, reply) => {
        const parse = changePasswordSchema.safeParse(request.body);
        if (!parse.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message },
            });
        }
        try {
            const userId = request.user.sub;
            const userRows = await db
                .select({
                id: users.id,
                passwordHash: users.passwordHash,
            })
                .from(users)
                .where(eq(users.id, userId))
                .limit(1);
            if (userRows.length === 0) {
                return reply.status(404).send({
                    success: false,
                    error: { code: 'USER_NOT_FOUND', message: 'User not found' },
                });
            }
            // Verify current password
            const isMatch = await bcrypt.compare(parse.data.currentPassword, userRows[0].passwordHash);
            if (!isMatch) {
                return reply.status(400).send({
                    success: false,
                    error: { code: 'INCORRECT_CURRENT_PASSWORD', message: 'Huidig wachtwoord is onjuist' },
                });
            }
            // Hash new password
            const newHash = await bcrypt.hash(parse.data.newPassword, 10);
            await db
                .update(users)
                .set({
                passwordHash: newHash,
                updatedAt: new Date(),
            })
                .where(eq(users.id, userId));
            return reply.send({
                success: true,
                message: 'Wachtwoord succesvol bijgewerkt!',
            });
        }
        catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to change password' },
            });
        }
    });
    /**
     * 4. POST /api/users/profile/avatar
     * Upload and set profile avatar
     */
    fastify.post('/avatar', async (request, reply) => {
        const parse = avatarUploadSchema.safeParse(request.body);
        if (!parse.success) {
            return reply.status(400).send({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message },
            });
        }
        try {
            const userId = request.user.sub;
            // Validate avatar MIME and size (max 5 MB)
            const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
            const allowedExts = ['jpg', 'jpeg', 'png', 'webp'];
            const ext = parse.data.fileName.split('.').pop()?.toLowerCase() || '';
            if (!allowedExts.includes(ext)) {
                return reply.status(400).send({
                    success: false,
                    error: { code: 'INVALID_AVATAR_TYPE', message: `Invalid avatar format .${ext}. Allowed: JPG, PNG, WEBP` },
                });
            }
            // Fetch user to check old avatar
            const userRows = await db
                .select({ id: users.id, avatarUrl: users.avatarUrl })
                .from(users)
                .where(eq(users.id, userId))
                .limit(1);
            if (userRows[0]?.avatarUrl) {
                try {
                    await storageService.deleteFile(userRows[0].avatarUrl);
                }
                catch (_) { }
            }
            // Save via StorageService
            const saved = await storageService.saveBase64('avatars', `avatar-${userId}.${ext}`, parse.data.fileBase64, parse.data.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`, true // isPhoto
            );
            if (saved.fileSizeBytes > MAX_AVATAR_SIZE) {
                await storageService.deleteFile(saved.filePath);
                return reply.status(400).send({
                    success: false,
                    error: { code: 'FILE_TOO_LARGE', message: 'Avatar image exceeds 5 MB limit' },
                });
            }
            // Update avatarUrl in database
            const relativeUrl = `/uploads/avatars/${saved.fileName}`;
            await db
                .update(users)
                .set({
                avatarUrl: relativeUrl,
                updatedAt: new Date(),
            })
                .where(eq(users.id, userId));
            return reply.send({
                success: true,
                data: {
                    avatarUrl: relativeUrl,
                },
                message: 'Profielfoto succesvol bijgewerkt!',
            });
        }
        catch (err) {
            fastify.log.error(err);
            return reply.status(400).send({
                success: false,
                error: { code: 'AVATAR_UPLOAD_FAILED', message: err.message },
            });
        }
    });
};
