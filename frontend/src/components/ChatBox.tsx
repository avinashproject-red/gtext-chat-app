import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { chatApi, userApi } from '../api/client';
import { encryptPayload, wrapConversationKey } from '../crypto/e2e';
import { ChatMessage, Conversation, MessageStatus, User } from '../types';

interface Props {
  conversation: Conversation;
  currentUser: User;
  socket: Socket | null;
  aesKey: CryptoKey | null;
  messages: ChatMessage[];
  typingUsers: string[];
  onMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onConversationUpdate: (conversation: Conversation) => void;
}

function senderId(sender: ChatMessage['sender']): string {
  return typeof sender === 'string' ? sender : sender.id || (sender as { _id?: string })._id || '';
}

function senderName(sender: ChatMessage['sender']): string {
  return typeof sender === 'string' ? 'Member' : sender.username;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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
  typingUsers,
  onMessages,
  onConversationUpdate,
}: Props) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<User[]>([]);
  const [error, setError] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const isAdmin = conversation.admins.map(String).includes(currentUser.id);

  const title = useMemo(() => {
    if (conversation.type === 'group') return conversation.name || 'Group';
    const other = conversation.participants.find((p) => p.id !== currentUser.id);
    return other?.username || 'Direct chat';
  }, [conversation, currentUser.id]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

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
      const dataUrl = await fileToDataUrl(file);
      await sendEncrypted(dataUrl, mediaKind(file), { filename: file.name, size: file.size });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const searchMembers = async (value: string) => {
    setMemberQuery(value);
    setMemberResults(value.trim() ? await userApi.search(value) : []);
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

  const statusLabel = (status: MessageStatus) => {
    if (status === 'read') return 'Read';
    if (status === 'delivered') return 'Delivered';
    return 'Sent';
  };

  return (
    <section className="chat-box" aria-label={title}>
      <header className="chat-header">
        <div>
          <h2>{title}</h2>
          <p className="muted">
            {conversation.type === 'group'
              ? `${conversation.participants.length} members`
              : conversation.participants.find((p) => p.id !== currentUser.id)?.isOnline
                ? 'Online'
                : 'Offline'}
            {typingUsers.length ? ` · ${typingUsers.join(', ')} typing` : ''}
          </p>
        </div>
        <button type="button" onClick={reportUser}>Report</button>
      </header>

      {conversation.type === 'group' && isAdmin ? (
        <div className="group-admin">
          <input
            value={memberQuery}
            onChange={(e) => searchMembers(e.target.value)}
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
                <img src={message.plaintext} alt={message.media?.filename || 'Shared image'} />
              ) : message.type === 'video' && message.plaintext ? (
                <video src={message.plaintext} controls />
              ) : message.type === 'document' && message.plaintext ? (
                <a href={message.plaintext} download={message.media?.filename || 'file'}>
                  {message.media?.filename || 'Download file'}
                </a>
              ) : (
                <p>{message.plaintext || (aesKey ? 'Decrypting…' : 'Waiting for encryption key')}</p>
              )}
              {mine && message.type !== 'system' ? (
                <span className="status">{statusLabel(message.status)}</span>
              ) : null}
            </article>
          );
        })}
      </div>

      {error ? <p className="error" role="alert">{error}</p> : null}

      <form className="composer" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="message">Message</label>
        <input
          id="message"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            socket?.emit(e.target.value ? 'typing:start' : 'typing:stop', { conversationId: conversation.id });
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
