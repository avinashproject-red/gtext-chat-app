export type UserRole = 'user' | 'admin';
export type MessageType = 'text' | 'image' | 'video' | 'document' | 'system';
export type MessageStatus = 'sent' | 'delivered' | 'read';
export type ConversationType = 'direct' | 'group';

export interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string;
  role: UserRole;
  publicKey?: string;
  privateKey?: Record<string, unknown>;
  lastSeen?: string;
  isOnline?: boolean;
  isBlocked?: boolean;
  createdAt?: string;
}

export interface Conversation {
  id: string;
  _id?: string;
  type: ConversationType;
  name?: string;
  avatar?: string;
  participants: User[];
  admins: string[];
  wrappedKeys: Record<string, string>;
  lastMessageAt?: string;
  lastMessageType?: MessageType;
  unreadCount?: number;
}

export interface ChatMessage {
  id?: string;
  _id?: string;
  conversation: string;
  sender: User | string;
  ciphertext: string;
  iv: string;
  type: MessageType;
  media?: { filename?: string; size?: number };
  status: MessageStatus;
  deliveredTo?: string[];
  readBy?: { user: string; at: string }[];
  createdAt: string;
  clientId?: string;
  plaintext?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}
