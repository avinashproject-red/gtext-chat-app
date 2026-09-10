import React, { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { compressAvatar } from '../utils/media';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [avatar, setAvatar] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register(username.trim(), email.trim(), password, avatar);
      navigate('/');
    } catch (err: any) {
      const message =
        err?.response?.data?.message ||
        err?.message ||
        (err?.code === 'ECONNABORTED'
          ? 'Server connection timed out. Please try again in a few seconds.'
          : 'Unable to create account');
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="register-title">
        <p className="eyebrow">GText</p>
        <h1 id="register-title">Create your account</h1>
        <p className="muted">Usernames, avatars, and end-to-end keys are generated on this device.</p>
        <form onSubmit={onSubmit} className="stack">
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} minLength={3} required />
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
          </label>
          <label>
            Profile picture
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  try {
                    setAvatar(await compressAvatar(file));
                  } catch {
                    setError('Could not read that image. Try a smaller photo.');
                  }
                }
              }}
            />
          </label>
          {avatar ? <img className="avatar-preview" src={avatar} alt="Selected profile" /> : null}
          {error ? <p className="error" role="alert">{error}</p> : null}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>
        <p className="muted">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
