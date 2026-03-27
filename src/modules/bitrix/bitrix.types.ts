export type BitrixSource = 'TELEGRAM' | 'WHATSAPP';

export type BitrixLeadStatus = 'NEW' | 'IN_PROCESS';

export interface BitrixListResponse<T> {
  result: T[];
  error?: string;
  error_description?: string;
}

export interface BitrixAddResponse {
  result: number;
  error?: string;
  error_description?: string;
}

export interface BitrixContact {
  ID: string;
  NAME?: string;
  PHONE?: Array<{ VALUE: string; VALUE_TYPE?: string }>;
}

export interface BitrixLead {
  ID: string;
  CONTACT_ID?: string;
  STATUS_ID?: string;
  TITLE?: string;
}

export interface BitrixContactAddFields {
  NAME: string;
  PHONE: Array<{ VALUE: string; VALUE_TYPE: 'WORK' | 'MOBILE' }>;
  SOURCE_ID?: string;
}

export interface BitrixLeadAddFields {
  TITLE: string;
  CONTACT_ID: number;
  SOURCE_ID?: string;
  STATUS_ID?: BitrixLeadStatus;
}

export interface BitrixTimelineCommentFields {
  ENTITY_ID: number;
  ENTITY_TYPE: 'lead';
  COMMENT: string;
}

export interface BitrixSyncPayload {
  messageId: number;
}

export interface BitrixOutgoingFields {
  ENTITY_ID: string;
  COMMENT: string;
}

export interface BitrixOutgoingPayload {
  event?: string;
  data?: {
    FIELDS?: BitrixOutgoingFields;
  };
}

export interface BitrixConnectorMessagePayload {
  CONNECTOR: string;
  LINE: string | number;
  auth?: string;
  MESSAGES: Array<{
    user: { id: string; name?: string | null };
    chat: { id: string };
    message: { id?: string; date?: number; text: string };
  }>;
}

export interface BitrixImIncomingPayload {
  data?: {
    message?: { text?: string };
    chat?: { id?: string };
  };
}

export interface BitrixIncomingMessageContext {
  text: string;
  source: ChatSource;
  bitrixChatId?: string;
  externalUserId?: string;
  externalMessageId?: string;
  localChatIdCandidate?: number;
}

export interface ChatMappingRecord {
  chatId: number;
  externalUserId: string;
  bitrixChatId?: string | null;
  source: string;
}

export type ChatSource = 'TELEGRAM' | 'WHATSAPP';

export interface SyncMessageContext {
  messageId: number;
  channel: string;
  direction: 'IN' | 'OUT';
  text: string;
  externalUserId: string;
  displayName: string;
  normalizedPhone: string;
  chatId: number;
}

export interface BitrixOauthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  domain?: string;
  error?: string;
  error_description?: string;
}

export interface BitrixTokenRecord {
  id: number;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  domain: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BitrixTokenUpsertInput {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  domain: string;
}

export interface BitrixRequestOptions {
  timeoutMs?: number;
  retryCount?: number;
}

export interface BitrixApiErrorPayload {
  error?: string;
  error_description?: string;
}
