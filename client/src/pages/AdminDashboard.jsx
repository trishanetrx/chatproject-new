import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../api';

export default function AdminDashboard() {
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const token = localStorage.getItem('admin_token');

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_URL}/admin/all-users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setUsers(data);
    } catch {
      navigate('/admin');
    }
  };

  const fetchMessages = async () => {
    try {
      const res = await fetch(`${API_URL}/admin/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (e) { console.error(e) }
  };

  useEffect(() => {
    if (!token) return navigate('/admin');
    
    Promise.all([fetchUsers(), fetchMessages()]).then(() => {
      setLoading(false);
    });
  }, [token, navigate]);

  const handleDeleteUser = async (id) => {
    if (!window.confirm("Delete this user?")) return;
    try {
      await fetch(`${API_URL}/admin/users/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      fetchUsers();
    } catch (e) { alert("Failed to delete user"); }
  };

  const handleKickUser = async (username) => {
    try {
      await fetch(`${API_URL}/admin/kick`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ username })
      });
      fetchUsers();
    } catch (e) { alert("Failed to kick user"); }
  };

  const handleBanUser = async (username) => {
    if (!window.confirm(`Ban ${username}?`)) return;
    try {
      await fetch(`${API_URL}/admin/ban`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ username })
      });
      fetchUsers();
    } catch (e) { alert("Failed to ban user"); }
  };

  const logout = () => {
    localStorage.removeItem('admin_token');
    navigate('/admin');
  };

  if (loading) return <div className="min-h-screen bg-slate-900 flex justify-center items-center text-white">Loading Admin Data...</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-300 p-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex justify-between items-center bg-slate-800/50 p-6 rounded-2xl border border-slate-700/50 mb-8 backdrop-blur-md">
          <div>
            <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
            <p className="text-slate-400 mt-1">Manage users, messages, and site settings.</p>
          </div>
          <button onClick={logout} className="px-5 py-2.5 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 font-medium rounded-xl transition-colors">
            Logout
          </button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* User Management */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 overflow-hidden backdrop-blur-md">
              <div className="p-6 border-b border-slate-700/50">
                <h2 className="text-xl font-bold text-white">Registered Users</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-900/50 text-slate-400 text-sm uppercase tracking-wider">
                      <th className="p-4 font-semibold">ID</th>
                      <th className="p-4 font-semibold">Username</th>
                      <th className="p-4 font-semibold">Status</th>
                      <th className="p-4 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {users.map(u => (
                      <tr key={u.id} className="hover:bg-slate-700/20 transition-colors">
                        <td className="p-4 text-slate-500">{u.id}</td>
                        <td className="p-4 font-medium text-white flex items-center gap-2">
                          {u.username}
                          {u.is_admin ? <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 text-xs rounded-full border border-indigo-500/20">Admin</span> : null}
                        </td>
                        <td className="p-4">
                          {u.is_online ? 
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span> Online
                            </span> : 
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-500"></span> Offline
                            </span>
                          }
                        </td>
                        <td className="p-4 text-right space-x-2">
                          {!u.is_admin && (
                            <>
                              <button onClick={() => handleKickUser(u.username)} className="px-3 py-1.5 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 rounded-lg text-sm transition-colors border border-yellow-500/20">Kick</button>
                              <button onClick={() => handleBanUser(u.username)} className="px-3 py-1.5 bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 rounded-lg text-sm transition-colors border border-orange-500/20">Ban</button>
                              <button onClick={() => handleDeleteUser(u.id)} className="px-3 py-1.5 bg-red-500/10 text-red-500 hover:bg-red-500/20 rounded-lg text-sm transition-colors border border-red-500/20">Delete</button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Messages Overview */}
          <div className="space-y-6">
            <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 flex flex-col h-[600px] backdrop-blur-md overflow-hidden">
              <div className="p-6 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/80">
                <h2 className="text-xl font-bold text-white">Recent Messages</h2>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map(m => (
                  <div key={m.id} className="p-3 bg-slate-900/50 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="font-medium text-pink-400 text-sm">{m.username}</span>
                      <span className="text-xs text-slate-500">{new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                    <p className="text-sm text-slate-300 break-words">{m.message}</p>
                  </div>
                ))}
                {messages.length === 0 && <div className="text-center text-slate-500 py-10">No messages found</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
