import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { chatApi, userApi } from '../api/client';
import { encryptPayload, wrapConversationKey } from '../crypto/e2e';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { ChatMessage, Conversation, User } from '../types';
import { prepareMediaPayload } from '../utils/media';

interface Props {
  conversation: Conversation;
  currentUser: User;
  socket: Socket | null;
  aesKey: CryptoKey | null;
  messages: ChatMessage[];
  onMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onConversationUpdate: (conversation: Conversation) => void;
}

function senderId(sender: ChatMessage['sender']): string {
  return typeof sender === 'string' ? sender : sender.id || (sender as { _id?: string })._id || '';
}

function senderName(sender: ChatMessage['sender']): string {
  return typeof sender === 'string' ? 'Member' : sender.username;
}

function mediaKind(file: File): 'image' | 'video' | 'document' {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return 'document';
}

export default function ChatBox({
  conversation,
  currentUser,
  socket,
  aesKey,
  messages,
  onMessages,
  onConversationUpdate,
}: Props) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [showMediaGallery, setShowMediaGallery] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [mediaTab, setMediaTab] = useState<'all' | 'media' | 'docs'>('all');
  const scroller = useRef<HTMLDivElement>(null);
  const isAdmin = conversation.admins.map(String).includes(currentUser.id);
  const debouncedMemberQuery = useDebouncedValue(memberQuery, 280);

  const title = useMemo(() => {
    if (conversation.type === 'group') return conversation.name || 'Group';
    const other = conversation.participants.find((p) => p.id !== currentUser.id);
    return other?.username || 'Direct chat';
  }, [conversation, currentUser.id]);

  const otherParticipant = useMemo(() => {
    if (conversation.type === 'group') return null;
    return conversation.participants.find((p) => p.id !== currentUser.id) || null;
  }, [conversation, currentUser.id]);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const value = debouncedMemberQuery.trim();
    if (!value) {
      setMemberResults([]);
      return;
    }
    let cancelled = false;
    userApi
      .search(value)
      .then((users) => {
        if (!cancelled) setMemberResults(users);
      })
      .catch(() => {
        if (!cancelled) setMemberResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedMemberQuery]);

  const sendEncrypted = async (plaintext: string, type: ChatMessage['type'], media?: ChatMessage['media']) => {
    if (!socket || !aesKey) throw new Error('Encryption is not ready yet');
    const { ciphertext, iv } = await encryptPayload(aesKey, plaintext);
    const clientId = crypto.randomUUID();
    const optimistic: ChatMessage = {
      clientId,
      conversation: conversation.id,
      sender: currentUser,
      ciphertext,
      iv,
      type,
      media,
      status: 'sent',
      createdAt: new Date().toISOString(),
      plaintext,
    };
    onMessages((prev) => [...prev, optimistic]);
    socket.emit('message:send', { conversationId: conversation.id, ciphertext, iv, type, media, clientId });
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    const text = draft.trim();
    setDraft('');
    try {
      await sendEncrypted(text, 'text');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const media = await prepareMediaPayload(file);
      await sendEncrypted(media.dataUrl, mediaKind(file), { filename: media.filename, size: media.size });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addMember = async (user: User) => {
    if (!aesKey || !user.publicKey) {
      setError('That user does not have an encryption key yet');
      return;
    }
    const wrappedKey = await wrapConversationKey(aesKey, user.publicKey);
    const updated = await chatApi.addMember(conversation.id, user.id, wrappedKey);
    onConversationUpdate(updated);
    setMemberQuery('');
    setMemberResults([]);
  };

  const reportUser = async () => {
    const other = conversation.participants.find((p) => p.id !== currentUser.id);
    if (!other) return;
    const reason = window.prompt(`Why are you reporting ${other.username}?`);
    if (!reason) return;
    await userApi.report({ targetUserId: other.id, conversationId: conversation.id, reason });
    window.alert('Report submitted to admins.');
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const mediaMessages = useMemo(() => {
    return messages.filter((m) => m.plaintext && (m.type === 'image' || m.type === 'video' || m.type === 'document'));
  }, [messages]);

  const filteredMedia = useMemo(() => {
    if (mediaTab === 'media') return mediaMessages.filter((m) => m.type === 'image' || m.type === 'video');
    if (mediaTab === 'docs') return mediaMessages.filter((m) => m.type === 'document');
    return mediaMessages;
  }, [mediaMessages, mediaTab]);

  return (
    <section className="chat-box" aria-label={title}>
      <header className="chat-header">
        <div>
          <h2>
            {conversation.type === 'group' ? (
              <span>{title}</span>
            ) : (
              <button type="button" className="chat-title-button" onClick={() => setShowProfile(true)}>
                {title}
              </button>
            )}
          </h2>
          <p className="muted">
            {conversation.type === 'group'
              ? `${conversation.participants.length} members`
              : otherParticipant?.isOnline
                ? 'Online'
                : 'Offline'}
          </p>
        </div>
        <div className="header-actions">
          <button type="button" onClick={() => setShowMediaGallery(true)}>
            Media ({mediaMessages.length})
          </button>
          <button type="button" onClick={reportUser}>Report</button>
        </div>
      </header>

      {showProfile && otherParticipant ? (
        <div className="modal-backdrop" onClick={() => setShowProfile(false)}>
          <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="brand-row">
              <h3>Profile</h3>
              <button type="button" className="icon" onClick={() => setShowProfile(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="profile-avatar-wrap">
              {otherParticipant.avatar ? (
                <img className="avatar-preview" src={otherParticipant.avatar} alt={otherParticipant.username} />
              ) : (
                <div className="avatar-preview avatar-placeholder">No photo</div>
              )}
            </div>
            <div className="profile-details">
              <p className="profile-name">{otherParticipant.username}</p>
              <p className="muted">{otherParticipant.email}</p>
              {otherParticipant.about ? <p className="muted">About: {otherParticipant.about}</p> : null}
              <p className="muted">{otherParticipant.isOnline ? 'Online now' : 'Offline'}</p>
            </div>
          </div>
        </div>
      ) : null}

      {showMediaGallery ? (
        <div className="modal-backdrop" onClick={() => setShowMediaGallery(false)}>
          <div className="modal media-modal" onClick={(e) => e.stopPropagation()}>
            <div className="brand-row">
              <h3>Shared Media ({mediaMessages.length})</h3>
              <button type="button" className="icon" onClick={() => setShowMediaGallery(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="chips">
              <button
                type="button"
                className={`chip ${mediaTab === 'all' ? 'active' : ''}`}
                onClick={() => setMediaTab('all')}
              >
                All ({mediaMessages.length})
              </button>
              <button
                type="button"
                className={`chip ${mediaTab === 'media' ? 'active' : ''}`}
                onClick={() => setMediaTab('media')}
              >
                Photos & Videos ({mediaMessages.filter((m) => m.type === 'image' || m.type === 'video').length})
              </button>
              <button
                type="button"
                className={`chip ${mediaTab === 'docs' ? 'active' : ''}`}
                onClick={() => setMediaTab('docs')}
              >
                Documents ({mediaMessages.filter((m) => m.type === 'document').length})
              </button>
            </div>
            <div className="media-grid">
              {filteredMedia.length === 0 ? (
                <p className="muted">No shared media found</p>
              ) : (
                filteredMedia.map((m) => (
                  <div key={m.id || m.clientId} className="media-item">
                    {m.type === 'image' && m.plaintext ? (
                      <img src={m.plaintext} alt={m.media?.filename || 'Media'} loading="lazy" decoding="async" />
                    ) : m.type === 'video' && m.plaintext ? (
                      <video src={m.plaintext} controls preload="metadata" />
                    ) : m.type === 'document' && m.plaintext ? (
                      <a href={m.plaintext} download={m.media?.filename || 'file'}>
                        {m.media?.filename || 'Download'}
                      </a>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {conversation.type === 'group' && isAdmin ? (
        <div className="group-admin">
          <input
            value={memberQuery}
            onChange={(e) => setMemberQuery(e.target.value)}
            placeholder="Add a member"
            aria-label="Add a group member"
          />
          {memberResults.map((user) => (
            <button key={user.id} type="button" onClick={() => addMember(user)}>
              Add {user.username}
            </button>
          ))}
          <div className="chips">
            {conversation.participants.map((member) => (
              <span key={member.id} className="chip">
                {member.username}
                {conversation.admins.includes(member.id) ? ' · admin' : ''}
                {member.id !== currentUser.id ? (
                  <>
                    <button type="button" onClick={() => chatApi.promoteAdmin(conversation.id, member.id).then(onConversationUpdate)}>
                      Promote
                    </button>
                    <button type="button" onClick={() => chatApi.removeMember(conversation.id, member.id).then(onConversationUpdate)}>
                      Remove
                    </button>
                  </>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="message-list" ref={scroller}>
        {messages.map((message) => {
          const mine = senderId(message.sender) === currentUser.id;
          return (
            <article key={message.id || message.clientId} className={`bubble ${mine ? 'mine' : ''}`}>
              {conversation.type === 'group' && !mine ? <strong>{senderName(message.sender)}</strong> : null}
              {message.type === 'system' ? (
                <p className="muted">{message.plaintext || message.ciphertext}</p>
              ) : message.type === 'image' && message.plaintext ? (
                <img src={message.plaintext} alt={message.media?.filename || 'Shared image'} loading="lazy" decoding="async" />
              ) : message.type === 'video' && message.plaintext ? (
                <video src={message.plaintext} controls preload="metadata" />
              ) : message.type === 'document' && message.plaintext ? (
                <a href={message.plaintext} download={message.media?.filename || 'file'}>
                  {message.media?.filename || 'Download file'}
                </a>
              ) : (
                <p>{message.plaintext || (aesKey ? 'Decrypting…' : 'Waiting for encryption key')}</p>
              )}
              {message.type !== 'system' ? (
                <span className="bubble-footer">
                  <span className="time">{formatTime(message.createdAt)}</span>
                  {mine ? (
                    <span className={`status-${message.status}`}>
                      {message.status === 'read' ? '✓✓' : message.status === 'delivered' ? '✓✓' : '✓'}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </article>
          );
        })}
      </div>

      {error ? <p className="error" role="alert">{error}</p> : null}

      <form className="composer" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="message">Message</label>
        <textarea
          id="message"
          className="composer-input"
          value={draft}
          rows={1}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          placeholder={aesKey ? 'Write an encrypted message' : 'Preparing encryption…'}
          disabled={!aesKey}
        />
        <label className="file-btn">
          Attach
          <input
            type="file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              e.target.value = '';
            }}
          />
        </label>
        <button className="primary" type="submit" disabled={!draft.trim() || busy || !aesKey}>
          Send
        </button>
      </form>
    </section>
  );
}
