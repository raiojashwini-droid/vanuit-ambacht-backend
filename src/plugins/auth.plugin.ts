import fp from 'fastify-plugin';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { authService } from '../services/auth.service.js';
import type { JwtTokenPayload, UserRole } from '../types/auth.types.js';

export const AUTH_COOKIE_NAME = 'va_auth_token';

const authPluginAsync: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. Register Cookie Plugin
  await fastify.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET || 'vanuit_ambacht_cookie_secret_2026',
    hook: 'onRequest',
  });

  // 2. Register JWT Plugin
  await fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'super_secret_vanuit_ambacht_jwt_key_2026',
    cookie: {
      cookieName: AUTH_COOKIE_NAME,
      signed: false,
    },
  });

  // 3. Decorate Authentication Guard
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Check HttpOnly Cookie first, then fallback to Authorization header
      const cookieToken = request.cookies[AUTH_COOKIE_NAME];
      const authHeader = request.headers.authorization;

      let decoded: JwtTokenPayload | null = null;

      if (cookieToken) {
        decoded = fastify.jwt.verify<JwtTokenPayload>(cookieToken);
      } else if (authHeader && authHeader.startsWith('Bearer ')) {
        const headerToken = authHeader.slice(7);
        decoded = fastify.jwt.verify<JwtTokenPayload>(headerToken);
      }

      if (!decoded) {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Authentication token missing or invalid',
          },
        });
      }

      request.user = decoded;

      // Handle Admin Preview / Impersonation if requested
      const impersonateRole = request.headers['x-impersonate-role'] as 'partner' | 'customer' | undefined;
      const impersonateId = request.headers['x-impersonate-id'] as string | undefined;

      if (impersonateRole || impersonateId) {
        // Enforce that ONLY administrators can activate preview/impersonation
        if (request.user.role !== 'admin') {
          return reply.status(403).send({
            success: false,
            error: {
              code: 'IMPERSONATION_FORBIDDEN',
              message: 'Preview and impersonation mode is restricted strictly to administrators',
            },
          });
        }

        if (!impersonateRole || !impersonateId) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'IMPERSONATION_INCOMPLETE',
              message: 'Both x-impersonate-role and x-impersonate-id headers must be supplied',
            },
          });
        }

        const validation = await authService.validateImpersonationTarget(impersonateRole, impersonateId);

        request.impersonation = {
          active: true,
          targetRole: impersonateRole,
          targetId: impersonateId,
          targetName: validation.name,
          adminUserId: request.user.sub,
        };
        request.effectiveRole = impersonateRole;
        request.effectiveProfileId = impersonateId;
      } else {
        request.impersonation = { active: false };
        request.effectiveRole = request.user.role;
        request.effectiveProfileId = request.user.profileId;
      }
    } catch (err: any) {
      if (err.statusCode) {
        return reply.status(err.statusCode).send({
          success: false,
          error: {
            code: err.code || 'AUTHENTICATION_ERROR',
            message: err.message,
          },
        });
      }
      fastify.log.warn({ err }, 'JWT Verification failed');
      return reply.status(401).send({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: err?.message || 'Authentication token is invalid or expired',
        },
      });
    }
  });

  // 4. Decorate Authorization Guard
  fastify.decorate('authorize', (allowedRoles: UserRole[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      // Must have already passed authenticate
      if (!request.user) {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Authentication required prior to authorization check',
          },
        });
      }

      const roleToCheck = request.effectiveRole || request.user.role;

      // Check if effective role is in allowed roles list
      // Note: If request.impersonation.active is false, an admin can only access admin routes
      // unless admin is explicitly in allowedRoles.
      const hasAccess = allowedRoles.includes(roleToCheck);

      if (!hasAccess) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Access denied. Role '${roleToCheck}' does not have required permissions. Required: [${allowedRoles.join(', ')}]`,
          },
        });
      }
    };
  });
};

export const authPlugin = fp(authPluginAsync, {
  name: 'auth-plugin',
});

/**
 * Cookie Helper: Sets the secure HttpOnly cookie for session management.
 */
export function setAuthCookie(reply: FastifyReply, token: string) {
  const isProduction = process.env.NODE_ENV === 'production';
  reply.setCookie(AUTH_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
  });
}

/**
 * Cookie Helper: Clears the authentication cookie upon logout.
 */
export function clearAuthCookie(reply: FastifyReply) {
  const isProduction = process.env.NODE_ENV === 'production';
  reply.clearCookie(AUTH_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
  });
}
