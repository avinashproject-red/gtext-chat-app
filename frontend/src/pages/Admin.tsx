import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { User } from '../types';

interface Stats {
  users: number;
  online: number;
  blocked: number;
  conversations: number;
  messages: number;
  openReports: number;
}

interface ReportItem {
  _id: string;
  reason: string;
  status: string;
  createdAt: string;
  reporter?: { username: string; email: string };
  targetUser?: { _id: string; username: string; email: string; isBlocked: boolean };
}

export default function Admin() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async (q = query) => {
    const [nextStats, nextUsers, nextReports] = await Promise.all([
      adminApi.stats(),
      adminApi.users(q),
      adminApi.reports(),
    ]);
    setStats(nextStats);
    setUsers(nextUsers);
    setReports(nextReports);
  }, [query]);

  useEffect(() => {
    refresh().catch((err) => setError(err?.response?.data?.message || 'Admin access failed'));
  }, [refresh]);

  if (!user || user.role !== 'admin') {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>Admin only</h1>
          <p>This dashboard is limited to administrators.</p>
          <Link to="/">Back to chat</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <p className="eyebrow">GText control</p>
          <h1>Admin dashboard</h1>
        </div>
        <Link to="/">Back to chat</Link>
      </header>
      {error ? <p className="error">{error}</p> : null}
      <section className="stat-grid">
        {stats
          ? Object.entries(stats).map(([key, value]) => (
              <article key={key} className="stat-card">
                <p className="muted">{key}</p>
                <strong>{value}</strong>
              </article>
            ))
          : null}
      </section>
      <section className="admin-panel">
        <h2>Users</h2>
        <input
          value={query}
          onChange={async (e) => {
            setQuery(e.target.value);
            setUsers(await adminApi.users(e.target.value));
          }}
          placeholder="Search users"
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id}>
                  <td>{item.username}</td>
                  <td>{item.email}</td>
                  <td>{item.isBlocked ? 'Blocked' : item.isOnline ? 'Online' : 'Offline'}</td>
                  <td>
                    {item.role === 'admin' ? (
                      'Admin'
                    ) : (
                      <button type="button" onClick={async () => {
                        await adminApi.block(item.id, !item.isBlocked);
                        refresh();
                      }}>
                        {item.isBlocked ? 'Unblock' : 'Block'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="admin-panel">
        <h2>Reports</h2>
        <ul className="report-list">
          {reports.map((report) => (
            <li key={report._id}>
              <div>
                <strong>{report.targetUser?.username}</strong> reported by {report.reporter?.username}
                <p>{report.reason}</p>
                <p className="muted">{report.status} · {new Date(report.createdAt).toLocaleString()}</p>
              </div>
              <div className="row">
                <button type="button" onClick={() => adminApi.updateReport(report._id, 'reviewed').then(() => refresh())}>
                  Mark reviewed
                </button>
                <button type="button" onClick={() => adminApi.updateReport(report._id, 'dismissed').then(() => refresh())}>
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
