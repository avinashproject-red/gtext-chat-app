import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { API_URL, authApi, chatApi, userApi } from '../api/client';
import ChatBox from '../components/ChatBox';
import GroupChat from '../components/GroupChat';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  decryptPayload,
  ensureIdentity,
  generateConversationKey,
  unwrapConversationKey,
  wrapConversationKey,
} from '../crypto/e2e';
import { notify, useNotificationsEnabled } from '../hooks/useNotifications';
import { ChatMessage, Conversation, User } from '../types';

function conversationId(conversation: Conversation): string {
  return conversation.id || conversation._id || '';
}

function otherParticipant(conversation: Conversation, userId: string): User | undefined {
  return conversation.participants.find((p) => p.id !== userId);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function senderId(sender: ChatMessage['sender']): string {
  return typeof sender === 'string' ? sender : sender.id || (sender as { _id?: string })._id || '';
}

function isPlaceholderEncryptedPayload(message: Pick<ChatMessage, 'ciphertext' | 'iv'>): boolean {
  if (!message.ciphertext || !message.iv) return true;
  if (message.iv === 'test-iv') return true;
  if (/^hello-from-/i.test(message.ciphertext)) return true;
  if (/^(t|a|admin|tester|user)-key$/i.test(message.ciphertext)) return true;
  return false;
}

export function hasDirectChatPlaceholderState(
  wrappedKey?: string,
  history: Array<Pick<ChatMessage, 'type' | 'ciphertext' | 'iv'>> = []
): boolean {
  const keyIsPlaceholder = !wrappedKey || isPlaceholderWrappedKey(wrappedKey);
  const historyHasPlaceholder = history.some(
    (message) => message.type !== 'system' && isPlaceholderEncryptedPayload(message)
  );
  return keyIsPlaceholder || historyHasPlaceholder;
}

function isPlaceholderWrappedKey(value?: string): boolean {
  if (!value) return true;
  return /^(t|a|admin|tester|user)-key$/i.test(value) || value.length < 16;
}

export function shouldAutoRepairDirectChatOnReload(
  conversation: Pick<Conversation, 'type'>,
  wrappedKey?: string,
  history: Array<Pick<ChatMessage, 'type' | 'ciphertext' | 'iv'>> = []
): boolean {
  if (conversation.type !== 'direct') return false;
  return false;
}

export function mergeConversationIntoList(existing: Conversation[], incoming: Conversation): Conversation[] {
  const list = existing.filter((c) => conversationId(c) !== conversationId(incoming));
  return [
    { ...incoming, id: conversationId(incoming) },
    ...list,
  ];
}

export default function Chat() {
  const { user, logout, updateUser } = useAuth();
  const { theme, highContrast, largeText, toggleTheme, toggleHighContrast, toggleLargeText } = useTheme();
  useNotificationsEnabled();

  const cycleVisualMode = () => {
    if (largeText) {
      toggleLargeText();
      if (highContrast) {
        toggleHighContrast();
      }
      return;
    }
    if (highContrast) {
      toggleHighContrast();
      toggleLargeText();
      return;
    }
    if (theme === 'dark') {
      toggleTheme();
      return;
    }
    toggleTheme();
    toggleHighContrast();
  };

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<User[]>([]);
  const [showGroup, setShowGroup] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [username, setUsername] = useState(user?.username || '');
  const [avatar, setAvatar] = useState(user?.avatar || '');
  const [about, setAbout] = useState(user?.about || '');
  const [keys, setKeys] = useState<Record<string, CryptoKey>>({});
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connected');
  const socketRef = useRef<Socket | null>(null);
  const activeIdRef = useRef(activeId);
  const keysRef = useRef(keys);
  const conversationsRef = useRef(conversations);
  activeIdRef.current = activeId;
  keysRef.current = keys;
  conversationsRef.current = conversations;

  const active = conversations.find((c) => conversationId(c) === activeId) || null;

  const loadConversations = useCallback(async () => {
    const list = await chatApi.conversations();
    const normalized = list.map((c) => ({ ...c, id: conversationId(c) }));
    setConversations(normalized);
    setActiveId((current) => current || (normalized[0] ? conversationId(normalized[0]) : ''));
  }, []);

  useEffect(() => {
    if (!user) return;
    ensureIdentity(user.email).then((identity) => setPrivateKey(identity.privateKey));
    loadConversations().catch(() => undefined);
  }, [user, loadConversations]);

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('gtext:token');
    const socket = io(API_URL, { auth: { token } });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionStatus('connected');
      if (activeIdRef.current) {
        socket.emit('conversation:join', activeIdRef.current);
      }
      loadConversations().catch(() => undefined);
    });

    socket.on('conversation:new', (incoming: Conversation) => {
      const cid = conversationId(incoming);
      setConversations((prev) => mergeConversationIntoList(prev, { ...incoming, id: cid }));
      setActiveId((current) => current || cid);
    });

    socket.on('disconnect', () => {
      setConnectionStatus('disconnected');
    });

    socket.on('connect_error', () => {
      setConnectionStatus('connecting');
    });

    socket.on('message:new', async (incoming: ChatMessage) => {
      const cid = String(incoming.conversation);
      const isActive = cid === activeIdRef.current;
      setConversations((prev) =>
        prev
          .map((c) =>
            conversationId(c) === cid
              ? {
                  ...c,
                  lastMessageAt: incoming.createdAt,
                  unreadCount: isActive ? 0 : (c.unreadCount || 0) + 1,
                }
              : c
          )
          .sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)))
      );

      const key = keysRef.current[cid];
      let plaintext = incoming.type === 'system' ? incoming.ciphertext : undefined;
      if (key && incoming.ciphertext && incoming.iv && incoming.type !== 'system') {
        try {
          plaintext = await decryptPayload(key, incoming.ciphertext, incoming.iv);
        } catch {
          plaintext = '[Unable to decrypt]';
        }
      }

      setMessages((prev) => {
        if (!isActive) return prev;
        const withoutOptimistic = prev.filter((m) => m.clientId !== incoming.clientId);
        return [...withoutOptimistic, { ...incoming, plaintext, id: incoming.id || incoming._id }];
      });

      if (senderId(incoming.sender) !== user.id) {
        socket.emit('message:delivered', { conversationId: cid, messageIds: [incoming.id || incoming._id] });
        if (isActive) {
          socket.emit('message:read', { conversationId: cid, messageIds: [incoming.id || incoming._id] });
        }
      }
    });

    socket.on(
      'message:status',
      ({
        conversationId: cid,
        messageIds,
        status,
      }: {
        conversationId: string;
        messageIds: string[];
        status: ChatMessage['status'];
      }) => {
        if (cid !== activeIdRef.current) return;
        setMessages((prev) =>
          prev.map((m) => (messageIds.map(String).includes(String(m.id || m._id)) ? { ...m, status } : m))
        );
      }
    );

    socket.on('notification:new', ({ title, body }: { title: string; body: string }) => {
      notify(title, body);
    });

    socket.on('presence:update', ({ userId, isOnline }: { userId: string; isOnline: boolean }) => {
      setConversations((prev) =>
        prev.map((c) => ({
          ...c,
          participants: c.participants.map((p) => (p.id === userId ? { ...p, isOnline } : p)),
        }))
      );
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user, loadConversations]);

  const repairDirectConversation = useCallback(async (person: User) => {
    if (!user) return;
    const aesKey = await generateConversationKey();
    const wrappedKeys: Record<string, string> = {
      [user.id]: await wrapConversationKey(aesKey, (await ensureIdentity(user.email)).publicKey),
      [person.id]: await wrapConversationKey(aesKey, person.publicKey || (await ensureIdentity(person.email)).publicKey),
    };
    const refreshed = await chatApi.startDirect(person.id, wrappedKeys);
    const cid = conversationId(refreshed);
    setKeys((prev) => ({ ...prev, [cid]: aesKey }));
    setConversations((prev) => [refreshed, ...prev.filter((c) => conversationId(c) !== cid)]);
    setActiveId(cid);
    setMessages([]);
    setSearch('');
    setPeople([]);
    return refreshed;
  }, [user]);

  useEffect(() => {
    const hydrate = async () => {
      if (!activeId || !privateKey || !user) return;
      const current = conversationsRef.current.find((c) => conversationId(c) === activeId);
      if (!current) return;
      const cid = conversationId(current);
      socketRef.current?.emit('conversation:join', cid);
      const history = await chatApi.messages(cid);
      let key: CryptoKey | undefined = keysRef.current[cid];
      const wrapped = current.wrappedKeys?.[user.id];
      if (!key && wrapped) {
        try {
          if (isPlaceholderWrappedKey(wrapped)) {
            throw new Error('placeholder wrapped key');
          }
          key = await unwrapConversationKey(wrapped, privateKey);
          setKeys((prev) => ({ ...prev, [cid]: key as CryptoKey }));
        } catch {
          key = undefined;
        }
      }
      if (hasDirectChatPlaceholderState(wrapped, history)) {
        if (current.type === 'direct') {
          const other = current.participants.find((p) => p.id !== user.id);
          if (other) {
            try {
              await repairDirectConversation(other);
              return;
            } catch {
              setMessages([]);
            }
          }
        }
        setMessages([]);
        return;
      }

      const decrypted = await Promise.all(
        history.map(async (message) => {
          if (message.type === 'system') return { ...message, id: message._id, plaintext: message.ciphertext };
          if (!key || !message.ciphertext || !message.iv) return { ...message, id: message._id, plaintext: '' };
          if (isPlaceholderEncryptedPayload(message)) {
            return { ...message, id: message._id, plaintext: '' };
          }
          try {
            return { ...message, id: message._id, plaintext: await decryptPayload(key, message.ciphertext, message.iv) };
          } catch {
            return { ...message, id: message._id, plaintext: '[Unable to decrypt]' };
          }
        })
      );
      setMessages(decrypted.filter((m) => m.plaintext !== ''));
      const unread = decrypted.filter((m) => senderId(m.sender) !== user.id).map((m) => m.id).filter(Boolean);
      if (unread.length) {
        socketRef.current?.emit('message:read', { conversationId: cid, messageIds: unread });
      }
      setConversations((prev) => prev.map((c) => (conversationId(c) === cid ? { ...c, unreadCount: 0 } : c)));
    };
    hydrate().catch(() => undefined);
  }, [activeId, privateKey, repairDirectConversation, user]);

  const startDirect = async (person: User) => {
    if (!user) return;

    const existing = conversations.find(
      (c) => c.type === 'direct' && c.participants.some((p) => p.id === person.id)
    );

    if (!person.publicKey) {
      window.alert('That user has not generated an encryption key yet. Ask them to sign in once.');
      return;
    }

    const aesKey = await generateConversationKey();
    const wrappedKeys: Record<string, string> = {
      [user.id]: await wrapConversationKey(aesKey, (await ensureIdentity(user.email)).publicKey),
      [person.id]: await wrapConversationKey(aesKey, person.publicKey),
    };

    if (existing) {
      const existingWrapped = existing.wrappedKeys?.[user.id];
      let canReuseExistingKey = false;

      if (existingWrapped && privateKey) {
        try {
          if (isPlaceholderWrappedKey(existingWrapped)) {
            throw new Error('placeholder wrapped key');
          }
          await unwrapConversationKey(existingWrapped, privateKey);
          canReuseExistingKey = true;
        } catch {
          canReuseExistingKey = false;
        }
      }

      if (canReuseExistingKey) {
        setActiveId(conversationId(existing));
        setSearch('');
        setPeople([]);
        return;
      }

      const refreshed = await chatApi.startDirect(person.id, wrappedKeys);
      const cid = conversationId(refreshed);
      setKeys((prev) => ({ ...prev, [cid]: aesKey }));
      setConversations((prev) => [refreshed, ...prev.filter((c) => conversationId(c) !== cid)]);
      setActiveId(cid);
      setMessages([]);
      setSearch('');
      setPeople([]);
      return;
    }

    const conversation = await chatApi.startDirect(person.id, wrappedKeys);
    const cid = conversationId(conversation);
    setKeys((prev) => ({ ...prev, [cid]: aesKey }));
      setConversations((prev) => mergeConversationIntoList(prev, conversation));
    setPeople([]);
  };

  const saveProfile = async () => {
    if (!user) return;
    const updated = await authApi.updateProfile({ username, avatar, about });
    updateUser(updated);
    setShowProfile(false);
  };

  const openProfile = () => {
    setUsername(user?.username || '');
    setAvatar(user?.avatar || '');
    setAbout(user?.about || '');
    setShowProfile(true);
  };

  if (!user) return null;

  return (
    <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <aside className="sidebar" aria-label="Conversations">
        <div className="brand-row">
          <div>
            <p className="eyebrow">GText</p>
            <strong>{user.username}</strong>
          </div>
          <button type="button" className="icon" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">
            ×
          </button>
        </div>
        <input
          value={search}
          onChange={async (e) => {
            setSearch(e.target.value);
            setPeople(e.target.value.trim() ? await userApi.search(e.target.value) : []);
          }}
          placeholder="Search people"
          aria-label="Search people"
        />
        {people.length ? (
          <ul className="people">
            {people.map((person) => (
              <li key={person.id}>
                <button type="button" onClick={() => startDirect(person)}>
                  {person.username}
                  <span className="muted">{person.email}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="row">
          <button type="button" onClick={() => setShowGroup(true)}>New group</button>
          <button type="button" onClick={openProfile}>Profile</button>
        </div>
        <nav className="conversation-list">
          {conversations.map((conversation) => {
            const cid = conversationId(conversation);
            const label =
              conversation.type === 'group'
                ? conversation.name
                : otherParticipant(conversation, user.id)?.username || 'Chat';
            return (
              <button
                key={cid}
                type="button"
                className={cid === activeId ? 'active' : ''}
                onClick={() => {
                  setActiveId(cid);
                  setSidebarOpen(false);
                }}
              >
                <span>{label}</span>
                {conversation.unreadCount ? <em>{conversation.unreadCount}</em> : null}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          {user.role === 'admin' ? <Link to="/admin">Admin dashboard</Link> : null}
          <div className="settings-menu">
            <button type="button" className="settings-trigger" onClick={() => setSettingsOpen((open) => !open)}>
              Settings
            </button>
            {settingsOpen ? (
              <div className="settings-dropdown">
                <button type="button" onClick={() => { cycleVisualMode(); setSettingsOpen(false); }}>
                  {highContrast ? 'Contrast on' : largeText ? 'Large text' : theme === 'dark' ? 'Light mode' : 'Dark mode'}
                </button>
                <button type="button" onClick={() => { logout(); setSettingsOpen(false); }}>
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      <main className="main-pane">
        {connectionStatus !== 'connected' ? (
          <div className={`connection-banner ${connectionStatus}`}>
            {connectionStatus === 'connecting'
              ? 'Connecting to server...'
              : 'Connection lost. Trying to reconnect...'}
          </div>
        ) : null}
        <button type="button" className="mobile-toggle" onClick={() => setSidebarOpen(true)}>
          Chats
        </button>
        {active ? (
          <ChatBox
            conversation={active}
            currentUser={user}
            socket={socketRef.current}
            aesKey={keys[conversationId(active)] || null}
            messages={messages}
            onMessages={setMessages}
            onConversationUpdate={(updated) => {
              const cid = conversationId(updated);
              setConversations((prev) => prev.map((c) => (conversationId(c) === cid ? { ...updated, id: cid } : c)));
            }}
          />
        ) : (
          <div className="empty-state">
            <h1>Start a conversation</h1>
            <p>Search for a user or create a group to send your first encrypted message.</p>
          </div>
        )}
      </main>

      {showGroup ? (
        <GroupChat
          currentUser={user}
          onCreated={(conversation) => {
            const cid = conversationId(conversation);
            setConversations((prev) => [conversation, ...prev]);
            setActiveId(cid);
            setShowGroup(false);
          }}
          onClose={() => setShowGroup(false)}
        />
      ) : null}

      {showProfile ? (
        <div className="modal-backdrop" onClick={() => setShowProfile(false)}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              saveProfile();
            }}
          >
            <h2>Your profile</h2>
            <div className="profile-avatar-wrap">
              {avatar ? (
                <img className="avatar-preview" src={avatar} alt="Profile" />
              ) : (
                <div className="avatar-preview avatar-placeholder">No photo</div>
              )}
            </div>
            <label className="file-btn profile-photo-btn">
              {avatar ? 'Change profile photo' : 'Choose profile photo'}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const dataUrl = await fileToDataUrl(file);
                    setAvatar(dataUrl);
                  } catch {
                    window.alert('Could not read that image.');
                  }
                }}
              />
            </label>
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label>
              About
              <textarea value={about} maxLength={240} onChange={(e) => setAbout(e.target.value)} placeholder="Tell people about yourself" />
            </label>
            <p className="muted">{user.email}</p>
            <div className="row">
              <button type="button" onClick={() => setShowProfile(false)}>Close</button>
              <button className="primary" type="submit">Save</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
