import type { FastifyPluginAsync } from 'fastify';
import { loginSchema } from '../schemas/auth.schema.js';
import { authService, AuthenticationError } from '../services/auth.service.js';
import { setAuthCookie, clearAuthCookie } from '../plugins/auth.plugin.js';
import type { JwtTokenPayload } from '../types/auth.types.js';

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/auth/login
   * Public login endpoint. Authenticates credentials and sets HttpOnly cookie.
   */
  fastify.post('/login', async (request, reply) => {
    // 1. Validate Input
    const parseResult = loginSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid login payload',
          details: parseResult.error.format(),
        },
      });
    }

    const { email, password } = parseResult.data;

    try {
      // 2. Authenticate user against DB
      const user = await authService.authenticate(email, password);

      // 3. Generate JWT Token
      const tokenPayload: JwtTokenPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        fullName: user.fullName,
        profileId: user.profileId || undefined,
      };

      const token = fastify.jwt.sign(tokenPayload, {
        expiresIn: '7d',
      });

      // 4. Set HttpOnly Cookie
      setAuthCookie(reply, token);

      // 5. Respond with user profile DTO (never sending password hash)
      return reply.status(200).send({
        success: true,
        message: 'Authentication successful',
        data: {
          user,
        },
      });
    } catch (err: any) {
      if (err instanceof AuthenticationError) {
        return reply.status(err.statusCode).send({
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
        });
      }

      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred during authentication',
        },
      });
    }
  });

  /**
   * POST /api/auth/logout
   * Clears the authentication HttpOnly cookie.
   */
  fastify.post('/logout', async (request, reply) => {
    clearAuthCookie(reply);
    return reply.status(200).send({
      success: true,
      message: 'Logged out successfully',
    });
  });

  /**
   * GET /api/auth/me
   * Protected endpoint. Rehydrates current session profile and returns active impersonation state.
   */
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const user = await authService.getUserById(request.user.sub);

      return reply.status(200).send({
        success: true,
        data: {
          user,
          impersonation: request.impersonation,
          effectiveRole: request.effectiveRole,
          effectiveProfileId: request.effectiveProfileId,
        },
      });
    } catch (err: any) {
      if (err instanceof AuthenticationError) {
        return reply.status(err.statusCode).send({
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
        });
      }

      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve user profile',
        },
      });
    }
  });

  /**
   * Role-verification test endpoints for testing and verification
   */
  fastify.get(
    '/test/admin-only',
    { preHandler: [fastify.authenticate, fastify.authorize(['admin'])] },
    async (request) => {
      return {
        success: true,
        message: 'Admin access granted',
        user: request.user,
        impersonation: request.impersonation,
      };
    }
  );

  fastify.get(
    '/test/partner-only',
    { preHandler: [fastify.authenticate, fastify.authorize(['partner'])] },
    async (request) => {
      return {
        success: true,
        message: 'Partner access granted',
        user: request.user,
        effectiveRole: request.effectiveRole,
        effectiveProfileId: request.effectiveProfileId,
        impersonation: request.impersonation,
      };
    }
  );

  fastify.get(
    '/test/customer-only',
    { preHandler: [fastify.authenticate, fastify.authorize(['customer'])] },
    async (request) => {
      return {
        success: true,
        message: 'Customer access granted',
        user: request.user,
        effectiveRole: request.effectiveRole,
        effectiveProfileId: request.effectiveProfileId,
        impersonation: request.impersonation,
      };
    }
  );
};
