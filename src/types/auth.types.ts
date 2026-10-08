import '@fastify/jwt';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { userRoleEnum } from '../db/schema.js';

export type UserRole = (typeof userRoleEnum.enumValues)[number];

export interface JwtTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  fullName: string;
  profileId?: string;
  iat?: number;
  exp?: number;
}

export interface ImpersonationState {
  active: boolean;
  targetRole?: 'partner' | 'customer';
  targetId?: string;
  targetName?: string;
  adminUserId?: string;
}

export interface AuthUserSummary {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
  phone?: string | null;
  isActive: boolean;
  profileId?: string | null;
  partnerCode?: string | null;
  customerNumber?: string | null;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtTokenPayload;
    user: JwtTokenPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authorize: (allowedRoles: UserRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    impersonation: ImpersonationState;
    effectiveRole: UserRole;
    effectiveProfileId?: string;
  }
}
