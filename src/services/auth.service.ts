import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, partners, customers } from '../db/schema.js';
import type { AuthUserSummary, UserRole } from '../types/auth.types.js';

export class AuthenticationError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 401, code = 'AUTHENTICATION_FAILED') {
    super(message);
    this.name = 'AuthenticationError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class AuthService {
  /**
   * Authenticate a user by email and plaintext password.
   * Enforces active status and secure bcrypt verification.
   */
  async authenticate(email: string, password: string): Promise<AuthUserSummary> {
    const normalizedEmail = email.trim().toLowerCase();

    const [userRecord] = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (!userRecord) {
      throw new AuthenticationError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    if (!userRecord.isActive) {
      throw new AuthenticationError(
        'Account is disabled. Please contact administrator.',
        403,
        'ACCOUNT_DISABLED'
      );
    }

    const isPasswordValid = await bcrypt.compare(password, userRecord.passwordHash);
    if (!isPasswordValid) {
      throw new AuthenticationError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    return this.enrichUserWithProfile(userRecord);
  }

  /**
   * Retrieves user profile by user UUID (for session revalidation).
   */
  async getUserById(userId: string): Promise<AuthUserSummary> {
    const [userRecord] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!userRecord) {
      throw new AuthenticationError('User no longer exists', 401, 'USER_NOT_FOUND');
    }

    if (!userRecord.isActive) {
      throw new AuthenticationError('Account is disabled', 403, 'ACCOUNT_DISABLED');
    }

    return this.enrichUserWithProfile(userRecord);
  }

  /**
   * Verifies an impersonation target requested by an administrator.
   */
  async validateImpersonationTarget(
    targetRole: 'partner' | 'customer',
    targetId: string
  ): Promise<{ valid: boolean; name: string }> {
    if (targetRole === 'partner') {
      const [partnerRecord] = await db
        .select()
        .from(partners)
        .where(eq(partners.id, targetId))
        .limit(1);

      if (!partnerRecord) {
        throw new AuthenticationError('Target partner for preview does not exist', 404, 'TARGET_NOT_FOUND');
      }
      return { valid: true, name: partnerRecord.companyName || partnerRecord.contactPerson };
    }

    if (targetRole === 'customer') {
      const [customerRecord] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, targetId))
        .limit(1);

      if (!customerRecord) {
        throw new AuthenticationError('Target customer for preview does not exist', 404, 'TARGET_NOT_FOUND');
      }
      return { valid: true, name: `${customerRecord.firstName} ${customerRecord.lastName}` };
    }

    throw new AuthenticationError('Invalid target role for preview', 400, 'INVALID_TARGET_ROLE');
  }

  /**
   * Enriches a raw database user row with profile details (partner or customer if applicable).
   */
  private async enrichUserWithProfile(userRecord: typeof users.$inferSelect): Promise<AuthUserSummary> {
    let profileId: string | null = null;
    let partnerCode: string | null = null;
    let customerNumber: string | null = null;

    if (userRecord.role === 'partner') {
      const [partnerRow] = await db
        .select()
        .from(partners)
        .where(eq(partners.userId, userRecord.id))
        .limit(1);

      if (partnerRow) {
        profileId = partnerRow.id;
        partnerCode = partnerRow.partnerCode;
      }
    } else if (userRecord.role === 'customer') {
      const [customerRow] = await db
        .select()
        .from(customers)
        .where(eq(customers.userId, userRecord.id))
        .limit(1);

      if (customerRow) {
        profileId = customerRow.id;
        customerNumber = customerRow.customerNumber;
      }
    }

    return {
      id: userRecord.id,
      email: userRecord.email,
      role: userRecord.role as UserRole,
      fullName: userRecord.fullName,
      phone: userRecord.phone,
      isActive: userRecord.isActive,
      profileId,
      partnerCode,
      customerNumber,
    };
  }
}

export const authService = new AuthService();
