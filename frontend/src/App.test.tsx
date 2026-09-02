import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { shouldAutoRepairDirectChatOnReload } from './pages/Chat';
import Login from './pages/Login';

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
