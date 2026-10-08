import { eq, or, ilike, sql, desc, asc, and, inArray, gt, ne } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { conversations, conversationParticipants, messages, documents, users, projects, leads, customers, partners, } from '../../db/schema.js';
export class ConversationError extends Error {
    statusCode;
    code;
    constructor(message, statusCode = 400, code = 'CONVERSATION_ERROR') {
        super(message);
        this.name = 'ConversationError';
        this.statusCode = statusCode;
        this.code = code;
    }
}
export class ConversationService {
    /**
     * Generate sequential conversation number in format CNV-YYYY-XXX
     */
    async generateConversationNumber(tx) {
        const client = tx || db;
        const year = new Date().getFullYear();
        const prefix = `CNV-${year}-`;
        const [latest] = await client
            .select({ conversationNumber: conversations.conversationNumber })
            .from(conversations)
            .where(ilike(conversations.conversationNumber, `${prefix}%`))
            .orderBy(desc(conversations.conversationNumber))
            .limit(1);
        if (!latest) {
            return `${prefix}001`;
        }
        const currentNumber = parseInt(latest.conversationNumber.replace(prefix, ''), 10);
        const nextSeq = isNaN(currentNumber) ? 1 : currentNumber + 1;
        return `${prefix}${nextSeq.toString().padStart(3, '0')}`;
    }
    /**
     * Helper to derive initials from a full name
     */
    getInitials(name) {
        if (!name)
            return 'VA';
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return name.slice(0, 2).toUpperCase();
    }
    /**
     * Helper to format a conversation with participants, unread count, and last message
     */
    async formatConversation(conv, currentUserId, currentUserRole) {
        // 1. Fetch participants
        const participantRows = await db
            .select({
            participant: conversationParticipants,
            user: users,
        })
            .from(conversationParticipants)
            .leftJoin(users, eq(conversationParticipants.userId, users.id))
            .where(eq(conversationParticipants.conversationId, conv.id));
        const participants = participantRows.map((r) => ({
            id: r.participant.id,
            userId: r.participant.userId,
            fullName: r.user?.fullName || 'Gebruiker',
            email: r.user?.email || '',
            role: r.user?.role || 'customer',
            roleInConversation: r.participant.roleInConversation,
            lastReadAt: r.participant.lastReadAt ? new Date(r.participant.lastReadAt).toISOString() : null,
        }));
        // 2. Identify Channel Type
        let channelType = 'internal';
        const hasCustomer = participants.some((p) => p.roleInConversation === 'customer');
        const hasPartner = participants.some((p) => p.roleInConversation === 'partner');
        if (hasCustomer) {
            channelType = 'customer';
        }
        else if (hasPartner) {
            channelType = 'partner';
        }
        // 3. Determine Counterparty (from perspective of current user)
        let counterparty = null;
        if (currentUserRole === 'admin') {
            // For Admin, counterparty is the customer or partner participant
            const external = participants.find((p) => p.roleInConversation !== 'admin');
            if (external) {
                counterparty = {
                    id: external.userId,
                    name: external.fullName,
                    role: external.roleInConversation,
                    initials: this.getInitials(external.fullName),
                };
            }
        }
        else {
            // For Customer/Partner, counterparty is Admin (Tim & Bram)
            const adminPart = participants.find((p) => p.roleInConversation === 'admin');
            if (adminPart) {
                counterparty = {
                    id: adminPart.userId,
                    name: 'Vanuit Ambacht (Tim & Bram)',
                    role: 'admin',
                    initials: 'VA',
                };
            }
        }
        // Fallback counterparty
        if (!counterparty && participants.length > 0) {
            const other = participants.find((p) => p.userId !== currentUserId) || participants[0];
            counterparty = {
                id: other.userId,
                name: other.fullName,
                role: other.roleInConversation,
                initials: this.getInitials(other.fullName),
            };
        }
        // 4. Fetch last message
        const [lastMsgRow] = await db
            .select({
            msg: messages,
            sender: users,
        })
            .from(messages)
            .leftJoin(users, eq(messages.senderUserId, users.id))
            .where(eq(messages.conversationId, conv.id))
            .orderBy(desc(messages.createdAt))
            .limit(1);
        const lastMessage = lastMsgRow
            ? {
                id: lastMsgRow.msg.id,
                content: lastMsgRow.msg.content,
                senderName: lastMsgRow.sender?.fullName || 'Gebruiker',
                createdAt: new Date(lastMsgRow.msg.createdAt).toISOString(),
            }
            : null;
        // 5. Calculate unread count for current user
        const currentParticipant = participants.find((p) => p.userId === currentUserId);
        let unreadCount = 0;
        if (currentParticipant) {
            const lastRead = currentParticipant.lastReadAt ? new Date(currentParticipant.lastReadAt) : new Date(0);
            const [unreadResult] = await db
                .select({ count: sql `count(*)` })
                .from(messages)
                .where(and(eq(messages.conversationId, conv.id), ne(messages.senderUserId, currentUserId), gt(messages.createdAt, lastRead)));
            unreadCount = Number(unreadResult?.count || 0);
        }
        // 6. Project & Lead info
        let project = null;
        if (conv.projectId) {
            const [p] = await db.select().from(projects).where(eq(projects.id, conv.projectId)).limit(1);
            if (p) {
                project = {
                    id: p.id,
                    name: p.name,
                    projectNumber: p.projectNumber,
                };
            }
        }
        let lead = null;
        if (conv.leadId) {
            const [l] = await db.select().from(leads).where(eq(leads.id, conv.leadId)).limit(1);
            if (l) {
                lead = {
                    id: l.id,
                    name: l.name,
                    leadNumber: l.leadNumber,
                };
            }
        }
        return {
            id: conv.id,
            conversationNumber: conv.conversationNumber,
            projectId: conv.projectId,
            project,
            leadId: conv.leadId,
            lead,
            title: conv.title,
            channelType,
            counterparty,
            participants,
            lastMessage,
            unreadCount,
            createdAt: new Date(conv.createdAt).toISOString(),
            updatedAt: new Date(conv.updatedAt).toISOString(),
        };
    }
    /**
     * Provision or fetch the two dedicated project channels (Customer Channel & Partner Channel)
     */
    async getOrProvisionProjectConversations(projectId, currentUserId, role, profileId) {
        const isProjUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId);
        const projCondition = isProjUuid
            ? or(eq(projects.id, projectId), eq(projects.projectNumber, projectId))
            : eq(projects.projectNumber, projectId);
        const [projectRow] = await db
            .select({
            project: projects,
            customer: customers,
            partner: partners,
        })
            .from(projects)
            .leftJoin(customers, eq(projects.customerId, customers.id))
            .leftJoin(partners, eq(projects.partnerId, partners.id))
            .where(projCondition)
            .limit(1);
        if (!projectRow) {
            throw new ConversationError('Project not found', 404, 'PROJECT_NOT_FOUND');
        }
        const { project, customer, partner } = projectRow;
        // RBAC check:
        if (role === 'customer') {
            if (customer && customer.id !== profileId && customer.userId !== currentUserId) {
                throw new ConversationError('Access denied: not your project', 403, 'FORBIDDEN');
            }
        }
        else if (role === 'partner') {
            if (partner && partner.id !== profileId && partner.userId !== currentUserId) {
                throw new ConversationError('Access denied: not your assigned project', 403, 'FORBIDDEN');
            }
        }
        // Find default admin user (to ensure Admin is always a participant)
        const [adminUser] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.role, 'admin'))
            .limit(1);
        const adminUserId = adminUser?.id || currentUserId;
        // 2. Query existing conversations for this project
        const existingConvs = await db
            .select()
            .from(conversations)
            .where(eq(conversations.projectId, projectId));
        let customerConv = null;
        let partnerConv = null;
        for (const c of existingConvs) {
            const parts = await db
                .select()
                .from(conversationParticipants)
                .where(eq(conversationParticipants.conversationId, c.id));
            if (parts.some((p) => p.roleInConversation === 'customer')) {
                customerConv = c;
            }
            else if (parts.some((p) => p.roleInConversation === 'partner')) {
                partnerConv = c;
            }
        }
        // 3. Provision Customer Channel if missing
        if (!customerConv && customer?.userId) {
            const convNum = await this.generateConversationNumber();
            const [newConv] = await db
                .insert(conversations)
                .values({
                conversationNumber: convNum,
                projectId: project.id,
                title: `${project.name} · Klant`,
            })
                .returning();
            // Add Admin participant
            await db.insert(conversationParticipants).values({
                conversationId: newConv.id,
                userId: adminUserId,
                roleInConversation: 'admin',
            });
            // Add Customer participant
            await db.insert(conversationParticipants).values({
                conversationId: newConv.id,
                userId: customer.userId,
                roleInConversation: 'customer',
            });
            customerConv = newConv;
        }
        // 4. Provision Partner Channel if missing
        if (!partnerConv && partner?.userId) {
            const convNum = await this.generateConversationNumber();
            const [newConv] = await db
                .insert(conversations)
                .values({
                conversationNumber: convNum,
                projectId: project.id,
                title: `${project.name} · Partner`,
            })
                .returning();
            // Add Admin participant
            await db.insert(conversationParticipants).values({
                conversationId: newConv.id,
                userId: adminUserId,
                roleInConversation: 'admin',
            });
            // Add Partner participant
            await db.insert(conversationParticipants).values({
                conversationId: newConv.id,
                userId: partner.userId,
                roleInConversation: 'partner',
            });
            partnerConv = newConv;
        }
        // 5. Format channels according to caller role
        let customerChannelDto = null;
        let partnerChannelDto = null;
        // Customer can NEVER see partner channel
        if (role !== 'partner' && customerConv) {
            customerChannelDto = await this.formatConversation(customerConv, currentUserId, role);
        }
        // Partner can NEVER see customer channel
        if (role !== 'customer' && partnerConv) {
            partnerChannelDto = await this.formatConversation(partnerConv, currentUserId, role);
        }
        return {
            projectId: project.id,
            projectNumber: project.projectNumber,
            projectName: project.name,
            customerChannel: customerChannelDto,
            partnerChannel: partnerChannelDto,
        };
    }
    /**
     * List conversations accessible to the authenticated user
     */
    async listConversations(currentUserId, role, profileId, filter = {}) {
        // Non-admins can ONLY see conversations they participate in
        let candidateConvIds = null;
        if (role !== 'admin') {
            const userParticipations = await db
                .select({ conversationId: conversationParticipants.conversationId })
                .from(conversationParticipants)
                .where(eq(conversationParticipants.userId, currentUserId));
            candidateConvIds = userParticipations.map((p) => p.conversationId);
            if (candidateConvIds.length === 0) {
                return [];
            }
        }
        const conditions = [];
        if (candidateConvIds) {
            conditions.push(inArray(conversations.id, candidateConvIds));
        }
        if (filter.projectId) {
            conditions.push(eq(conversations.projectId, filter.projectId));
        }
        if (filter.leadId) {
            conditions.push(eq(conversations.leadId, filter.leadId));
        }
        if (filter.search && filter.search.trim()) {
            const q = `%${filter.search.trim()}%`;
            conditions.push(or(ilike(conversations.title, q), ilike(conversations.conversationNumber, q), ilike(projects.name, q)));
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        const convRows = await db
            .select({
            conv: conversations,
        })
            .from(conversations)
            .leftJoin(projects, eq(conversations.projectId, projects.id))
            .where(whereClause)
            .orderBy(desc(conversations.updatedAt));
        const results = [];
        for (const r of convRows) {
            const formatted = await this.formatConversation(r.conv, currentUserId, role);
            // Filter by channelType if specified
            if (filter.channelType && formatted.channelType !== filter.channelType) {
                continue;
            }
            // Filter by unreadOnly if specified
            if (filter.unreadOnly && formatted.unreadCount === 0) {
                continue;
            }
            results.push(formatted);
        }
        return results;
    }
    /**
     * Get single conversation by ID or code with security checks
     */
    async getConversationById(id, currentUserId, role, profileId) {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        let [conv] = await db
            .select()
            .from(conversations)
            .where(isUuid ? eq(conversations.id, id) : eq(conversations.conversationNumber, id))
            .limit(1);
        if (!conv) {
            // Check if `id` is a project UUID or projectNumber
            const projectConditions = isUuid
                ? or(eq(projects.id, id), eq(projects.projectNumber, id))
                : eq(projects.projectNumber, id);
            const [proj] = await db.select().from(projects).where(projectConditions).limit(1);
            if (proj) {
                const channels = await this.getOrProvisionProjectConversations(proj.id, currentUserId, role, profileId);
                const resolvedDto = role === 'partner' ? channels.partnerChannel : (channels.customerChannel || channels.partnerChannel);
                if (resolvedDto) {
                    return resolvedDto;
                }
            }
            throw new ConversationError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
        }
        // Role check: non-admin must be a participant
        if (role !== 'admin') {
            const [participant] = await db
                .select()
                .from(conversationParticipants)
                .where(and(eq(conversationParticipants.conversationId, conv.id), eq(conversationParticipants.userId, currentUserId)))
                .limit(1);
            if (!participant) {
                throw new ConversationError('Access denied for this conversation', 403, 'FORBIDDEN');
            }
        }
        return this.formatConversation(conv, currentUserId, role);
    }
    /**
     * Fetch chronological messages for a conversation
     */
    async listMessages(conversationId, currentUserId, role, options = {}) {
        // Security check: verify caller has access to conversation
        const conv = await this.getConversationById(conversationId, currentUserId, role);
        const limit = Math.min(200, Math.max(1, options.limit || 100));
        const conditions = [eq(messages.conversationId, conv.id)];
        if (options.before) {
            conditions.push(sql `${messages.createdAt} < ${options.before}`);
        }
        const rows = await db
            .select({
            msg: messages,
            sender: users,
            doc: documents,
        })
            .from(messages)
            .leftJoin(users, eq(messages.senderUserId, users.id))
            .leftJoin(documents, eq(messages.attachmentDocumentId, documents.id))
            .where(and(...conditions))
            .orderBy(asc(messages.createdAt))
            .limit(limit);
        return rows.map((r) => {
            const senderName = r.sender?.fullName || 'Gebruiker';
            const senderRole = r.sender?.role || 'customer';
            const initials = this.getInitials(senderName);
            let attachment = null;
            if (r.doc) {
                attachment = {
                    id: r.doc.id,
                    fileName: r.doc.fileName,
                    fileUrl: r.doc.fileUrl,
                    mimeType: r.doc.mimeType,
                    fileSizeBytes: r.doc.fileSizeBytes ? Number(r.doc.fileSizeBytes) : null,
                };
            }
            return {
                id: r.msg.id,
                conversationId: r.msg.conversationId,
                senderUserId: r.msg.senderUserId,
                senderName,
                senderRole,
                senderInitials: initials,
                content: r.msg.content,
                attachment,
                isRead: r.msg.isRead,
                createdAt: new Date(r.msg.createdAt).toISOString(),
            };
        });
    }
    /**
     * Send a text message (and optionally attach a document)
     */
    async sendMessage(conversationId, senderUserId, role, data) {
        const conv = await this.getConversationById(conversationId, senderUserId, role);
        // Validate attachment document if specified
        if (data.attachmentDocumentId) {
            const [doc] = await db
                .select({ id: documents.id })
                .from(documents)
                .where(eq(documents.id, data.attachmentDocumentId))
                .limit(1);
            if (!doc) {
                throw new ConversationError('Attachment document not found', 404, 'DOCUMENT_NOT_FOUND');
            }
        }
        // Insert message
        const [newMsg] = await db
            .insert(messages)
            .values({
            conversationId: conv.id,
            senderUserId,
            content: data.content.trim(),
            attachmentDocumentId: data.attachmentDocumentId || null,
            isRead: false,
        })
            .returning();
        // Update conversation updatedAt
        const now = new Date();
        await db
            .update(conversations)
            .set({ updatedAt: now })
            .where(eq(conversations.id, conv.id));
        // Update sender's lastReadAt
        await db
            .update(conversationParticipants)
            .set({ lastReadAt: now })
            .where(and(eq(conversationParticipants.conversationId, conv.id), eq(conversationParticipants.userId, senderUserId)));
        const [senderUser] = await db
            .select({ fullName: users.fullName, role: users.role })
            .from(users)
            .where(eq(users.id, senderUserId))
            .limit(1);
        const senderName = senderUser?.fullName || 'Gebruiker';
        const senderRole = senderUser?.role || 'customer';
        let attachment = null;
        if (newMsg.attachmentDocumentId) {
            const [doc] = await db
                .select()
                .from(documents)
                .where(eq(documents.id, newMsg.attachmentDocumentId))
                .limit(1);
            if (doc) {
                attachment = {
                    id: doc.id,
                    fileName: doc.fileName,
                    fileUrl: doc.fileUrl,
                    mimeType: doc.mimeType,
                    fileSizeBytes: doc.fileSizeBytes ? Number(doc.fileSizeBytes) : null,
                };
            }
        }
        return {
            id: newMsg.id,
            conversationId: newMsg.conversationId,
            senderUserId: newMsg.senderUserId,
            senderName,
            senderRole,
            senderInitials: this.getInitials(senderName),
            content: newMsg.content,
            attachment,
            isRead: newMsg.isRead,
            createdAt: new Date(newMsg.createdAt).toISOString(),
        };
    }
    /**
     * Mark a conversation as read for the calling user
     */
    async markAsRead(conversationId, currentUserId, role) {
        const conv = await this.getConversationById(conversationId, currentUserId, role);
        const now = new Date();
        await db
            .update(conversationParticipants)
            .set({ lastReadAt: now })
            .where(and(eq(conversationParticipants.conversationId, conv.id), eq(conversationParticipants.userId, currentUserId)));
        // Update isRead = true on messages sent by others
        await db
            .update(messages)
            .set({ isRead: true })
            .where(and(eq(messages.conversationId, conv.id), ne(messages.senderUserId, currentUserId)));
        return { markedRead: true };
    }
    /**
     * Fast unread count across all conversations accessible to the user
     */
    async getUnreadCount(currentUserId) {
        // Find all participant rows for this user
        const userParticipations = await db
            .select({
            conversationId: conversationParticipants.conversationId,
            lastReadAt: conversationParticipants.lastReadAt,
        })
            .from(conversationParticipants)
            .where(eq(conversationParticipants.userId, currentUserId));
        if (userParticipations.length === 0) {
            return { totalUnread: 0 };
        }
        let totalUnread = 0;
        for (const p of userParticipations) {
            const lastRead = p.lastReadAt ? new Date(p.lastReadAt) : new Date(0);
            const [countResult] = await db
                .select({ count: sql `count(*)` })
                .from(messages)
                .where(and(eq(messages.conversationId, p.conversationId), ne(messages.senderUserId, currentUserId), gt(messages.createdAt, lastRead)));
            totalUnread += Number(countResult?.count || 0);
        }
        return { totalUnread };
    }
    /**
     * Manually create a conversation thread (Admin only)
     */
    async createConversation(data, createdByUserId, role) {
        if (role !== 'admin') {
            throw new ConversationError('Only administrators can manually create conversations', 403, 'FORBIDDEN');
        }
        if (data.projectId) {
            const [proj] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, data.projectId)).limit(1);
            if (!proj)
                throw new ConversationError('Project not found', 404, 'PROJECT_NOT_FOUND');
        }
        if (data.leadId) {
            const [ld] = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, data.leadId)).limit(1);
            if (!ld)
                throw new ConversationError('Lead not found', 404, 'LEAD_NOT_FOUND');
        }
        const conversationNumber = await this.generateConversationNumber();
        const [newConv] = await db
            .insert(conversations)
            .values({
            conversationNumber,
            projectId: data.projectId || null,
            leadId: data.leadId || null,
            title: data.title.trim(),
        })
            .returning();
        // Add creator as admin participant
        await db.insert(conversationParticipants).values({
            conversationId: newConv.id,
            userId: createdByUserId,
            roleInConversation: 'admin',
        });
        // Add additional participant user IDs if supplied
        if (Array.isArray(data.participantUserIds)) {
            for (const uId of data.participantUserIds) {
                if (uId === createdByUserId)
                    continue;
                const [userRow] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, uId)).limit(1);
                if (userRow) {
                    const roleInConv = (userRow.role === 'partner' ? 'partner' : userRow.role === 'customer' ? 'customer' : 'admin');
                    await db
                        .insert(conversationParticipants)
                        .values({
                        conversationId: newConv.id,
                        userId: userRow.id,
                        roleInConversation: roleInConv,
                    })
                        .onConflictDoNothing();
                }
            }
        }
        return this.formatConversation(newConv, createdByUserId, role);
    }
}
export const conversationService = new ConversationService();
