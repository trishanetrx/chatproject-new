import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Flag, LogOut, MessageCircle, RefreshCw, Search, Shield, ShieldX, Trash2, Users, X } from 'lucide-react';
import '../anonymous.css';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const token = localStorage.getItem('admin_token');
  const [users, setUsers] = useState([]);
  const [reports, setReports] = useState([]);
  const [messages, setMessages] = useState([]);
  const [tab, setTab] = useState('reports');
  const [filter, setFilter] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [busy, setBusy] = useState(false);
  const request = async (path, options = {}) => {
    const response = await fetch('/api/admin/' + path, { ...options,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...options.headers } });
    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem('admin_token'); navigate('/admin'); throw new Error('Please sign in again.');
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Request failed.');
    return data;
  };
  const refresh = async () => {
    try {
      const [nextUsers, nextReports, nextMessages] = await Promise.all([request('all-users'), request('reports'), request('messages')]);
      setUsers(nextUsers); setReports(nextReports); setMessages(nextMessages); setError('');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    if (!token) { navigate('/admin'); return; }
    refresh();
    const interval = setInterval(refresh, 45000);
    return () => clearInterval(interval);
  }, [token]);
  const action = async (path, body, method = 'POST') => {
    setBusy(true);
    try {
      const result = await request(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (path === 'guest-ban' && !result.banned) throw new Error('This identity has expired or cannot be suspended.');
      setNotice(result.message || 'Action completed.'); setConfirmation(null); await refresh();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const pending = reports.filter(report => !report.resolved).length;
  const visibleReports = reports.filter(report => showResolved || !report.resolved);
  const visibleUsers = users.filter(user => user.username.toLowerCase().includes(filter.toLowerCase()));
  return <div className="anonymous-app moderation-app">
    <header className="anon-topbar"><Link to="/" className="anon-brand"><MessageCircle size={26} /><h1>clipmanz<span>.</span></h1><span className="anon-brand-label">moderation</span></Link><button className="anon-secondary" onClick={() => { localStorage.removeItem('admin_token'); navigate('/admin'); }}><LogOut size={15} />Sign out</button></header>
    <main className="moderation-main">
      <div className="moderation-title"><div><span className="anon-eyebrow">COMMUNITY OPERATIONS</span><h2>Moderation desk</h2><p>{pending} open reports · {users.filter(user => user.is_online).length} account users online</p></div><button className="anon-secondary" onClick={refresh} disabled={busy}><RefreshCw size={15} />Refresh</button></div>
      {error && <div className="anon-feedback is-error" role="alert">{error}</div>}
      {notice && <div className="anon-feedback" role="status">{notice}<button className="anon-icon" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={15} /></button></div>}
      <div className="moderation-tabs" role="tablist" aria-label="Moderation views">
        {[['reports', Flag, 'Reports'], ['users', Users, 'Accounts'], ['messages', MessageCircle, 'Legacy messages']].map(([id, Icon, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'is-selected' : ''} onClick={() => setTab(id)}><Icon size={15} />{label}{id === 'reports' && <span>{pending}</span>}</button>)}
      </div>
      {loading ? <p className="moderation-empty">Loading moderation data...</p> : tab === 'reports' ? <>
        <div className="moderation-toolbar"><p>Reports expire after seven days. Review the evidence before acting.</p><label><input type="checkbox" checked={showResolved} onChange={event => setShowResolved(event.target.checked)} />Include resolved</label></div>
        <div className="moderation-report-list">{visibleReports.map(report => {
          let evidence; try { evidence = JSON.parse(report.evidence); } catch { evidence = { alias: report.target, message: 'Evidence unavailable' }; }
          return <article className="moderation-report" key={report.id}>
            <div className="moderation-report-heading"><strong>{evidence.alias}</strong><span>{report.reason}</span><time>{new Date(report.created).toLocaleString()}</time></div>
            <p>{evidence.message}</p><small>Report #{report.id} · {report.resolved ? 'Resolved' : 'Awaiting review'}</small>
            {!report.resolved && <div className="moderation-report-actions"><button className="anon-secondary" disabled={busy} onClick={() => action('reports/' + report.id + '/resolve')}><Check size={15} />Resolve</button><button className="anon-secondary is-danger" disabled={busy} onClick={() => setConfirmation({ label: 'Suspend this identity?', description: 'The current session will be disconnected. Guest suspensions last until the identity expires. Account suspensions remain until unbanned.', path: 'guest-ban', body: { id: report.target } })}><ShieldX size={15} />Suspend identity</button></div>}
          </article>;
        })}{!visibleReports.length && <div className="moderation-empty"><Shield size={30} /><h3>No open reports.</h3><p>New reports will appear here.</p></div>}</div>
      </> : tab === 'users' ? <>
        <div className="moderation-toolbar"><label className="moderation-search"><Search size={16} /><input aria-label="Search accounts" placeholder="Search accounts..." value={filter} onChange={event => setFilter(event.target.value)} /></label><span>{visibleUsers.length} accounts</span></div>
        <div className="moderation-table-scroll"><table><thead><tr><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visibleUsers.map(user => <tr key={user.id}><td><strong>{user.username}</strong></td><td>{user.is_admin ? 'Moderator' : 'Member'}</td><td>{user.is_online ? 'Online' : 'Offline'}</td><td>{!user.is_admin && <div className="moderation-table-actions"><button className="anon-icon" aria-label={'Kick ' + user.username} title="Kick" disabled={busy} onClick={() => action('kick', { username: user.username })}><LogOut size={16} /></button><button className="anon-icon" aria-label={'Ban ' + user.username} title="Ban" disabled={busy} onClick={() => setConfirmation({ label: 'Ban ' + user.username + '?', description: 'This account will be blocked from logging in or chatting.', path: 'ban', body: { username: user.username } })}><ShieldX size={16} /></button><button className="anon-icon" aria-label={'Unban ' + user.username} title="Unban" disabled={busy} onClick={() => action('unban', { username: user.username })}><Check size={16} /></button><button className="anon-icon" aria-label={'Delete ' + user.username} title="Delete account" disabled={busy} onClick={() => setConfirmation({ label: 'Delete ' + user.username + '?', description: 'This removes the account and its saved conversation history.', path: 'users/' + user.id, method: 'DELETE' })}><Trash2 size={16} /></button></div>}</td></tr>)}</tbody></table></div>
      </> : <><div className="moderation-toolbar"><p>Messages from the earlier account chat.</p><button className="anon-secondary is-danger" disabled={!messages.length || busy} onClick={() => setConfirmation({ label: 'Delete all legacy messages?', description: 'This permanently removes messages from the earlier account chat.', path: 'messages/delete-all', method: 'DELETE' })}><Trash2 size={15} />Delete all</button></div><div className="moderation-report-list">{messages.map(message => <article className="moderation-report" key={message.id}><div className="moderation-report-heading"><strong>{message.username}</strong><time>{new Date(message.timestamp).toLocaleString()}</time><button className="anon-icon" title="Delete message" aria-label="Delete message" onClick={() => setConfirmation({ label: 'Delete this message?', description: message.message, path: 'messages/' + message.id, method: 'DELETE' })}><Trash2 size={15} /></button></div><p>{message.message}</p></article>)}</div></>}
    </main>
    {confirmation && <div className="anon-modal-backdrop"><div className="anon-modal" role="dialog" aria-modal="true" aria-labelledby="moderation-confirm-title"><div className="anon-modal-heading"><h2 id="moderation-confirm-title">{confirmation.label}</h2><button className="anon-icon" aria-label="Close confirmation" onClick={() => setConfirmation(null)}><X size={18} /></button></div><p>{confirmation.description}</p><div className="anon-modal-actions"><button className="anon-secondary" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button><button className="anon-primary" disabled={busy} onClick={() => action(confirmation.path, confirmation.body, confirmation.method)}>{busy ? 'Working...' : 'Confirm'}</button></div></div></div>}
  </div>;
}
