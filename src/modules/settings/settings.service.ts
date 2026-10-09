import { db } from '../../db/index.js';
import { companySettings, users, partners, customers } from '../../db/schema.js';
import { eq, and, ne, desc, asc, count, ilike } from 'drizzle-orm';
import bcryptjs from 'bcryptjs';
import type {
  CompanySettingsDto,
  UpdateCompanySettingsDto,
  SettingsConfigSection,
  SystemUserDto,
  CreateSystemUserDto,
} from './settings.types.js';

export class SettingsError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
    public code: string = 'SETTINGS_ERROR'
  ) {
    super(message);
    this.name = 'SettingsError';
  }
}

export class SettingsService {
  /**
   * Helper to format company settings row into DTO
   */
  private formatCompanySettings(row: any): CompanySettingsDto {
    return {
      id: row.id,
      companyName: row.companyName,
      website: row.website,
      kvkNumber: row.kvkNumber,
      btwNumber: row.btwNumber,
      iban: row.iban,
      bankName: row.bankName,
      email: row.email,
      phone: row.phone,
      address: row.address,
      postalCode: row.postalCode,
      city: row.city,
      country: row.country,
      standardVatRate: parseFloat(row.standardVatRate || '21.00'),
      lowVatRate: parseFloat(row.lowVatRate || '9.00'),
      quotePrefix: row.quotePrefix || '#Q-2004',
      invoicePrefix: row.invoicePrefix || '#INV-902',
      defaultMarginPercentage: parseFloat(row.defaultMarginPercentage || '35.00'),
      quoteTermsText: row.quoteTermsText,
      fiscalLockDate: row.fiscalLockDate ? String(row.fiscalLockDate) : null,
      brandingColors: row.brandingColors || { primary: '#3E4E36', accent: '#70624F', background: '#D6CFC2' },
      categoriesConfig: row.categoriesConfig || null,
      fieldsetsConfig: row.fieldsetsConfig || null,
      partnerBreakdownConfig: row.partnerBreakdownConfig || null,
      plConfig: row.plConfig || null,
      messageTemplates: row.messageTemplates || null,
      quoteTemplateConfig: row.quoteTemplateConfig || null,
      integrationsConfig: row.integrationsConfig || { googleCalendar: false, gmail: false },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private cachedCompanySettings: { data: CompanySettingsDto; expiresAt: number } | null = null;

  /**
   * 1. GET /api/settings/company
   * Retrieve company profile, financial configurations, VAT rates, numbering formats, and dynamic JSON configs
   */
  async getCompanySettings(): Promise<CompanySettingsDto> {
    const now = Date.now();
    if (this.cachedCompanySettings && this.cachedCompanySettings.expiresAt > now) {
      return this.cachedCompanySettings.data;
    }

    const [existing] = await db.select().from(companySettings).limit(1);

    let result: CompanySettingsDto;
    if (existing) {
      result = this.formatCompanySettings(existing);
    } else {
      // If no row exists yet, initialize a default row
      const [created] = await db
        .insert(companySettings)
        .values({
          companyName: 'Vanuit Ambacht B.V.',
          website: 'www.vanuitambacht.nl',
          kvkNumber: 'KVK-88741029',
          btwNumber: 'NL88741029B01',
          iban: 'NL91 ABNA 0417 1234 56',
          bankName: 'ABN AMRO Bank',
          email: 'info@vanuitambacht.nl',
          phone: '+31 6 12345678',
          address: 'Herengracht 1',
          postalCode: '1015 BG',
          city: 'Amsterdam',
          country: 'NL',
          standardVatRate: '21.00',
          lowVatRate: '9.00',
          quotePrefix: '#Q-2004',
          invoicePrefix: '#INV-902',
          defaultMarginPercentage: '35.00',
        })
        .returning();

      result = this.formatCompanySettings(created);
    }

    this.cachedCompanySettings = {
      data: result,
      expiresAt: now + 30 * 1000,
    };

    return result;
  }

  /**
   * 2. PUT /api/settings/company
   * Update company details, VAT rates, numbering prefixes, or disclaimer text
   */
  async updateCompanySettings(input: UpdateCompanySettingsDto): Promise<CompanySettingsDto> {
    const [existing] = await db.select().from(companySettings).limit(1);

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (input.companyName !== undefined) updateData.companyName = input.companyName;
    if (input.website !== undefined) updateData.website = input.website;
    if (input.kvkNumber !== undefined) updateData.kvkNumber = input.kvkNumber;
    if (input.btwNumber !== undefined) updateData.btwNumber = input.btwNumber;
    if (input.iban !== undefined) updateData.iban = input.iban;
    if (input.bankName !== undefined) updateData.bankName = input.bankName;
    if (input.email !== undefined) updateData.email = input.email;
    if (input.phone !== undefined) updateData.phone = input.phone;
    if (input.address !== undefined) updateData.address = input.address;
    if (input.postalCode !== undefined) updateData.postalCode = input.postalCode;
    if (input.city !== undefined) updateData.city = input.city;
    if (input.country !== undefined) updateData.country = input.country;
    if (input.standardVatRate !== undefined) updateData.standardVatRate = String(input.standardVatRate);
    if (input.lowVatRate !== undefined) updateData.lowVatRate = String(input.lowVatRate);
    if (input.quotePrefix !== undefined) updateData.quotePrefix = input.quotePrefix;
    if (input.invoicePrefix !== undefined) updateData.invoicePrefix = input.invoicePrefix;
    if (input.defaultMarginPercentage !== undefined) updateData.defaultMarginPercentage = String(input.defaultMarginPercentage);
    if (input.quoteTermsText !== undefined) updateData.quoteTermsText = input.quoteTermsText;
    if (input.fiscalLockDate !== undefined) updateData.fiscalLockDate = input.fiscalLockDate;
    if (input.brandingColors !== undefined) updateData.brandingColors = input.brandingColors;
    if (input.categoriesConfig !== undefined) updateData.categoriesConfig = input.categoriesConfig;
    if (input.fieldsetsConfig !== undefined) updateData.fieldsetsConfig = input.fieldsetsConfig;
    if (input.partnerBreakdownConfig !== undefined) updateData.partnerBreakdownConfig = input.partnerBreakdownConfig;
    if (input.plConfig !== undefined) updateData.plConfig = input.plConfig;
    if (input.messageTemplates !== undefined) updateData.messageTemplates = input.messageTemplates;
    if (input.quoteTemplateConfig !== undefined) updateData.quoteTemplateConfig = input.quoteTemplateConfig;
    if (input.integrationsConfig !== undefined) updateData.integrationsConfig = input.integrationsConfig;

    let resultRow: any;

    if (existing) {
      const [updated] = await db
        .update(companySettings)
        .set(updateData)
        .where(eq(companySettings.id, existing.id))
        .returning();
      resultRow = updated;
    } else {
      const [created] = await db
        .insert(companySettings)
        .values({
          companyName: input.companyName || 'Vanuit Ambacht B.V.',
          ...updateData,
        })
        .returning();
      resultRow = created;
    }

    this.cachedCompanySettings = null;
    return this.formatCompanySettings(resultRow);
  }

  /**
   * 3. PATCH /api/settings/config/:section
   * Granular update of dynamic configuration sections
   */
  async updateSectionConfig(section: SettingsConfigSection, payload: any): Promise<CompanySettingsDto> {
    const updatePayload: UpdateCompanySettingsDto = {};

    switch (section) {
      case 'branding':
        updatePayload.brandingColors = payload;
        break;
      case 'categories':
        updatePayload.categoriesConfig = payload;
        break;
      case 'fieldsets':
        updatePayload.fieldsetsConfig = payload;
        break;
      case 'partner-breakdown':
        updatePayload.partnerBreakdownConfig = payload;
        break;
      case 'pl-targets':
        updatePayload.plConfig = payload;
        if (payload?.targetMargin && typeof payload.targetMargin === 'number') {
          updatePayload.defaultMarginPercentage = payload.targetMargin;
        }
        break;
      case 'templates':
        updatePayload.messageTemplates = payload;
        break;
      case 'quote-template':
        updatePayload.quoteTemplateConfig = payload;
        break;
      case 'integrations':
        updatePayload.integrationsConfig = payload;
        break;
      default:
        throw new SettingsError(`Unsupported configuration section: ${section}`, 400, 'INVALID_SECTION');
    }

    this.cachedCompanySettings = null;
    return this.updateCompanySettings(updatePayload);
  }

  /**
   * 4. GET /api/settings/users
   * List all registered system users (never returning password hashes)
   */
  async listUsers(): Promise<SystemUserDto[]> {
    const rows = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        role: users.role,
        phone: users.phone,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    return rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      role: r.role,
      phone: r.phone,
      isActive: r.isActive,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  /**
   * 5. POST /api/settings/users
   * Create or invite a new system user
   */
  async createUser(input: CreateSystemUserDto): Promise<SystemUserDto> {
    const normalizedEmail = input.email.toLowerCase().trim();

    // 1. Check for duplicate email
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existing) {
      throw new SettingsError(
        `A user with email "${normalizedEmail}" already exists`,
        409,
        'DUPLICATE_EMAIL'
      );
    }

    // 2. Hash password with bcryptjs
    const passwordHash = await bcryptjs.hash(input.password, 10);

    // 3. Insert into users table
    const [newUser] = await db
      .insert(users)
      .values({
        fullName: input.fullName.trim(),
        email: normalizedEmail,
        passwordHash,
        role: input.role,
        phone: input.phone || null,
        isActive: true,
      })
      .returning({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        role: users.role,
        phone: users.phone,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });

    // 4. Auto-create Partner profile if role is 'partner'
    if (input.role === 'partner') {
      try {
        const cleanName = (input.fullName || 'PRT')
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, 4);
        const prefix = cleanName ? `PRT-${cleanName}-` : 'PRT-';
        const [latest] = await db
          .select({ partnerCode: partners.partnerCode })
          .from(partners)
          .where(ilike(partners.partnerCode, `${prefix}%`))
          .orderBy(desc(partners.partnerCode))
          .limit(1);
        const suffix = latest ? parseInt(latest.partnerCode.replace(prefix, ''), 10) : 0;
        const nextSeq = isNaN(suffix) ? 1 : suffix + 1;
        const partnerCode = `${prefix}${nextSeq.toString().padStart(2, '0')}`;

        await db.insert(partners).values({
          userId: newUser.id,
          partnerCode,
          companyName: input.fullName.trim(),
          contactPerson: input.fullName.trim(),
          email: normalizedEmail,
          phone: input.phone || '+31 6 00000000',
          workloadStatus: 'available',
          rating: '5.00',
          isActive: true,
        });
      } catch (err) {
        console.error('Failed to auto-create partner profile in settings:', err);
      }
    } else if (input.role === 'customer') {
      try {
        const [latest] = await db
          .select({ customerNumber: customers.customerNumber })
          .from(customers)
          .where(ilike(customers.customerNumber, 'CUST-%'))
          .orderBy(desc(customers.customerNumber))
          .limit(1);
        const currentNumber = latest ? parseInt(latest.customerNumber.replace('CUST-', ''), 10) : 0;
        const nextSeq = isNaN(currentNumber) ? 1 : currentNumber + 1;
        const customerNumber = `CUST-${nextSeq.toString().padStart(3, '0')}`;

        const nameParts = input.fullName.trim().split(' ');
        const firstName = nameParts[0] || 'Customer';
        const lastName = nameParts.slice(1).join(' ') || 'Account';

        await db.insert(customers).values({
          userId: newUser.id,
          customerNumber,
          firstName,
          lastName,
          email: normalizedEmail,
          phone: input.phone || '+31 6 00000000',
          city: 'Amsterdam',
          country: 'NL',
        });
      } catch (err) {
        console.error('Failed to auto-create customer profile in settings:', err);
      }
    }

    return {
      id: newUser.id,
      fullName: newUser.fullName,
      email: newUser.email,
      role: newUser.role,
      phone: newUser.phone,
      isActive: newUser.isActive,
      createdAt: newUser.createdAt.toISOString(),
      updatedAt: newUser.updatedAt.toISOString(),
    };
  }

  /**
   * 6. PATCH /api/settings/users/:id/status
   * Toggle user active/inactive status with self-deactivation & last-admin protection
   */
  async updateUserStatus(
    targetUserId: string,
    isActive: boolean,
    currentAdminUserId: string
  ): Promise<SystemUserDto> {
    // 1. Fetch target user
    const [targetUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!targetUser) {
      throw new SettingsError('User not found', 404, 'USER_NOT_FOUND');
    }

    // 2. Self-deactivation guard
    if (targetUserId === currentAdminUserId && !isActive) {
      throw new SettingsError(
        'You cannot deactivate your own administrative account',
        400,
        'SELF_DEACTIVATION_PROHIBITED'
      );
    }

    // 3. Last active admin protection
    if (targetUser.role === 'admin' && !isActive) {
      const [adminCountResult] = await db
        .select({ count: count() })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true), ne(users.id, targetUserId)));

      const otherActiveAdmins = Number(adminCountResult?.count || 0);
      if (otherActiveAdmins === 0) {
        throw new SettingsError(
          'Cannot deactivate the sole active admin in the system',
          400,
          'SOLE_ADMIN_PROTECTED'
        );
      }
    }

    // 4. Update status
    const [updated] = await db
      .update(users)
      .set({
        isActive,
        updatedAt: new Date(),
      })
      .where(eq(users.id, targetUserId))
      .returning({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        role: users.role,
        phone: users.phone,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });

    try {
      await db
        .update(partners)
        .set({ isActive, updatedAt: new Date() })
        .where(eq(partners.userId, targetUserId));
    } catch (err) {}

    return {
      id: updated.id,
      fullName: updated.fullName,
      email: updated.email,
      role: updated.role,
      phone: updated.phone,
      isActive: updated.isActive,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * 7. PATCH /api/settings/users/:id/role
   * Update user role with sole-admin demotion protection
   */
  async updateUserRole(
    targetUserId: string,
    newRole: 'admin' | 'partner' | 'customer',
    currentAdminUserId: string
  ): Promise<SystemUserDto> {
    const [targetUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!targetUser) {
      throw new SettingsError('User not found', 404, 'USER_NOT_FOUND');
    }

    // Sole-admin demotion protection
    if (targetUser.role === 'admin' && newRole !== 'admin') {
      const [adminCountResult] = await db
        .select({ count: count() })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true), ne(users.id, targetUserId)));

      const otherActiveAdmins = Number(adminCountResult?.count || 0);
      if (otherActiveAdmins === 0) {
        throw new SettingsError(
          'Cannot demote the sole active admin in the system',
          400,
          'SOLE_ADMIN_PROTECTED'
        );
      }
    }

    const [updated] = await db
      .update(users)
      .set({
        role: newRole,
        updatedAt: new Date(),
      })
      .where(eq(users.id, targetUserId))
      .returning({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        role: users.role,
        phone: users.phone,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });

    if (newRole === 'partner') {
      try {
        const [existingPartner] = await db
          .select({ id: partners.id })
          .from(partners)
          .where(eq(partners.userId, targetUserId))
          .limit(1);
        if (!existingPartner) {
          const cleanName = (targetUser.fullName || 'PRT')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 4);
          const prefix = cleanName ? `PRT-${cleanName}-` : 'PRT-';
          const [latest] = await db
            .select({ partnerCode: partners.partnerCode })
            .from(partners)
            .where(ilike(partners.partnerCode, `${prefix}%`))
            .orderBy(desc(partners.partnerCode))
            .limit(1);
          const suffix = latest ? parseInt(latest.partnerCode.replace(prefix, ''), 10) : 0;
          const nextSeq = isNaN(suffix) ? 1 : suffix + 1;
          const partnerCode = `${prefix}${nextSeq.toString().padStart(2, '0')}`;

          await db.insert(partners).values({
            userId: targetUserId,
            partnerCode,
            companyName: targetUser.fullName.trim(),
            contactPerson: targetUser.fullName.trim(),
            email: targetUser.email,
            phone: targetUser.phone || '+31 6 00000000',
            workloadStatus: 'available',
            rating: '5.00',
            isActive: targetUser.isActive,
          });
        }
      } catch (err) {}
    }

    return {
      id: updated.id,
      fullName: updated.fullName,
      email: updated.email,
      role: updated.role,
      phone: updated.phone,
      isActive: updated.isActive,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }
}

export const settingsService = new SettingsService();
