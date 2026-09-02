import React, { FormEvent, useMemo, useState } from 'react';
import { chatApi, userApi } from '../api/client';
import { generateConversationKey, wrapConversationKey } from '../crypto/e2e';
import { Conversation, User } from '../types';

interface Props {
  currentUser: User;
  onCreated: (conversation: Conversation) => void;
  onClose: () => void;
}

export default function GroupChat({ currentUser, onCreated, onClose }: Props) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [selected, setSelected] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedIds = useMemo(() => new Set(selected.map((u) => u.id)), [selected]);

  const search = async (value: string) => {
    setQuery(value);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    setResults(await userApi.search(value));
  };

  const toggle = (user: User) => {
    setSelected((prev) =>
      prev.some((u) => u.id === user.id) ? prev.filter((u) => u.id !== user.id) : [...prev, user]
    );
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || selected.length === 0) {
      setError('Add a group name and at least one member');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const aesKey = await generateConversationKey();
      const members = [currentUser, ...selected];
      const wrappedKeys: Record<string, string> = {};
      for (const member of members) {
        if (!member.publicKey) throw new Error(`${member.username} has no encryption key yet`);
        wrappedKeys[member.id] = await wrapConversationKey(aesKey, member.publicKey);
      }
      const conversation = await chatApi.createGroup({
        name: name.trim(),
        participantIds: selected.map((u) => u.id),
        wrappedKeys,
      });
      onCreated(conversation);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
        || (err as { message?: string }).message;
      setError(message || 'Could not create group');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit} aria-labelledby="group-title">
        <h2 id="group-title">New group chat</h2>
        <label>
          Group name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Add people
          <input value={query} onChange={(e) => search(e.target.value)} placeholder="Search username or email" />
        </label>
        <ul className="picker-list">
          {results.map((user) => (
            <li key={user.id}>
              <button type="button" className={selectedIds.has(user.id) ? 'selected' : ''} onClick={() => toggle(user)}>
                {user.username} <span className="muted">{user.email}</span>
              </button>
            </li>
          ))}
        </ul>
        {selected.length ? <p className="muted">Selected: {selected.map((u) => u.username).join(', ')}</p> : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="row">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create group'}
          </button>
        </div>
      </form>
    </div>
  );
}
