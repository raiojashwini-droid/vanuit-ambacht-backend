export type ChannelType = 'customer' | 'partner' | 'internal';
export type ConversationRole = 'admin' | 'partner' | 'customer';

export interface ConversationParticipantDto {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  role: string;
  roleInConversation: ConversationRole;
  lastReadAt: string | null;
}

export interface MessageAttachmentDto {
  id: string;
  fileName: string;
  fileUrl: string;
  mimeType: string | null;
  fileSizeBytes: number | null;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderName: string;
  senderRole: string;
  senderInitials: string;
  content: string;
  attachment: MessageAttachmentDto | null;
  isRead: boolean;
  createdAt: string;
}

export interface ConversationDto {
  id: string;
  conversationNumber: string;
  projectId: string | null;
  project: {
    id: string;
    name: string;
    projectNumber: string;
  } | null;
  leadId: string | null;
  lead: {
    id: string;
    name: string;
    leadNumber: string;
  } | null;
  title: string;
  channelType: ChannelType;
  counterparty: {
    id: string;
    name: string;
    role: string;
    initials: string;
  } | null;
  participants: ConversationParticipantDto[];
  lastMessage: {
    id: string;
    content: string;
    senderName: string;
    createdAt: string;
  } | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectChannelsDto {
  projectId: string;
  projectNumber: string;
  projectName: string;
  customerChannel: ConversationDto | null;
  partnerChannel: ConversationDto | null;
}

export interface SendMessageInput {
  content: string;
  attachmentDocumentId?: string | null;
}

export interface CreateConversationInput {
  projectId?: string;
  leadId?: string;
  title: string;
  channelType: ChannelType;
  participantUserIds?: string[];
}

export interface ListConversationsFilter {
  projectId?: string;
  leadId?: string;
  channelType?: ChannelType;
  unreadOnly?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}
