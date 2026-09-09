import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { hasDirectChatPlaceholderState, mergeConversationIntoList, shouldAutoRepairDirectChatOnReload } from './pages/Chat';
import Login from './pages/Login';
import { Conversation } from './types';

test('adds a newly created direct or group conversation to the live list immediately', () => {
  const existing: Conversation[] = [
    { id: 'old', type: 'group', name: 'Old group', participants: [], admins: [], wrappedKeys: {} },
  ];
  const incoming: Conversation = {
    id: 'new-chat',
    type: 'direct',
    participants: [],
    admins: [],
    wrappedKeys: {},
  };

  const merged = mergeConversationIntoList(existing, incoming);
  expect(merged.some((c) => c.id === 'new-chat')).toBe(true);
  expect(merged[0].id).toBe('new-chat');
});

test('flags placeholder direct-chat encrypted content for a repair path', () => {
  expect(hasDirectChatPlaceholderState('t-key', [{ type: 'text', ciphertext: 'hello-from-tester', iv: 'test-iv' }])).toBe(true);
  expect(hasDirectChatPlaceholderState('real-wrapped-key-value', [{ type: 'text', ciphertext: 'still-valid', iv: 'real-iv-12-bytes' }])).toBe(false);
});

test('renders login heading', () => {
  render(
    <MemoryRouter>
      <ThemeProvider>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
  expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
});

test('does not auto-repair direct chats on reload', () => {
  expect(
    shouldAutoRepairDirectChatOnReload(
      { type: 'direct' },
      't-key',
      [{ type: 'text', ciphertext: 'hello-from-tester', iv: 'test-iv' }]
    )
  ).toBe(false);

  expect(
    shouldAutoRepairDirectChatOnReload(
      { type: 'direct' },
      'real-wrapped-key-value',
      [{ type: 'text', ciphertext: 'still-valid', iv: 'real-iv-12-bytes' }]
    )
  ).toBe(false);
});
