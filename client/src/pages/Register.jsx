import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { API_URL } from '../api';

export default function Register() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captchaInput, setCaptchaInput] = useState('');
  const [captchaSvg, setCaptchaSvg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const fetchCaptcha = async () => {
    try {
      // The backend sets a cookie on this request
      const res = await fetch(`${API_URL}/captcha`, {credentials: 'include'});
      const svgText = await res.text();
      setCaptchaSvg(svgText);
    } catch (err) {
      console.error("Failed to fetch captcha", err);
    }
  };

  useEffect(() => {
    fetchCaptcha();
  }, []);

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    
    if (username.length < 3) return setError('Username must be at least 3 characters.');
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password, captcha: captchaInput })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Registration failed');

      navigate('/login');
    } catch (err) {
      setError(err.message);
      fetchCaptcha(); // Refresh captcha on failure
      setCaptchaInput('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-900 px-4 relative">
      <div className="bg-white/10 backdrop-blur-xl border border-white/10 p-8 rounded-2xl w-full max-w-md shadow-2xl relative z-10">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-pink-400 to-orange-400 bg-clip-text text-transparent mb-6 text-center">
          Create Account
        </h2>
        
        {error && <div className="bg-red-500/20 text-red-300 p-3 rounded-lg mb-4 text-sm border border-red-500/50">{error}</div>}

        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Username</label>
            <input 
              type="text" 
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
              placeholder="Choose a username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Password</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
              placeholder="••••••••"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Security Check</label>
            <div className="flex gap-2 mb-2 bg-slate-800/50 border border-slate-700 rounded-xl p-2 items-center justify-center overflow-hidden" 
                 dangerouslySetInnerHTML={{ __html: captchaSvg }} 
                 onClick={fetchCaptcha}
                 title="Click to refresh captcha"
                 style={{ cursor: 'pointer' }}>
            </div>
            <input 
              type="text" 
              required
              value={captchaInput}
              onChange={(e) => setCaptchaInput(e.target.value)}
              className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
              placeholder="Enter captcha"
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-gradient-to-r from-pink-500 to-orange-400 text-white font-semibold rounded-xl px-4 py-3 hover:scale-[1.02] transition-transform shadow-lg shadow-pink-500/30 disabled:opacity-50 mt-2"
          >
            {loading ? 'Registering...' : 'Sign Up'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          Already have an account? <Link to="/login" className="text-pink-400 hover:text-pink-300 font-medium">Log in</Link>
        </p>
      </div>
    </div>
  );
}
