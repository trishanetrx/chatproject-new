import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, History, MessageCircle, RefreshCw, Shield, UserRound } from 'lucide-react';
import '../anonymous.css';

export default function AccountAccess({ variant = 'login' }) {
  const register = variant === 'register';
  const admin = variant === 'admin';
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [captchaUrl, setCaptchaUrl] = useState('');
  const captchaRef = useRef('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    try {
      const response = await fetch('/api/captcha', { credentials: 'include' });
      if (!response.ok) throw new Error('Unable to load the security check.');
      const url = URL.createObjectURL(await response.blob());
      if (captchaRef.current) URL.revokeObjectURL(captchaRef.current);
      captchaRef.current = url; setCaptchaUrl(url); setCaptcha('');
    } catch (err) { setError(err.message); }
  };
  useEffect(() => {
    if (register) refresh();
    return () => { if (captchaRef.current) URL.revokeObjectURL(captchaRef.current); };
  }, [register]);
  const submit = async event => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const response = await fetch(`/api/${admin ? 'admin/login' : register ? 'register' : 'login'}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, ...(register ? { captcha } : {}) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to continue.');
      if (register) navigate('/login', { state: { registered: true } });
      else {
        if (admin) localStorage.setItem('admin_token', data.token);
        else localStorage.setItem('chat_user', JSON.stringify(data));
        navigate(admin ? '/admin/dashboard' : '/account-chat');
      }
    } catch (err) { setError(err.message); if (register) refresh(); }
    finally { setBusy(false); }
  };
  return <div className="anonymous-app account-auth"><header className="anon-topbar"><Link to="/" className="anon-brand"><MessageCircle size={26} /><h1>clipmanz<span>.</span></h1></Link><Link className="anon-back-link" to="/"><ArrowLeft size={15} />Guest chat</Link></header><main className="account-auth-main"><div className="account-auth-form"><div className="anon-entry-icon">{admin ? <Shield size={27} /> : <UserRound size={27} />}</div><span className="anon-eyebrow">{admin ? 'MODERATOR ACCESS' : 'YOUR NAME. YOUR CONVERSATIONS.'}</span><h2>{admin ? 'Moderator sign in' : register ? 'Make yourself at home.' : 'Welcome back.'}</h2><p>{admin ? 'Review reports and keep conversations safe.' : register ? 'Choose a name and keep your conversations across visits.' : 'Sign in to your account and pick up where you left off.'}</p>{error && <div className="anon-feedback is-error" role="alert">{error}</div>}<form onSubmit={submit}><label htmlFor="account-name">Username</label><input id="account-name" autoComplete="username" required minLength={register ? 3 : undefined} maxLength={50} value={username} onChange={event => setUsername(event.target.value)} placeholder="Your username" /><label htmlFor="account-password">Password</label><input id="account-password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 6 : undefined} maxLength={200} value={password} onChange={event => setPassword(event.target.value)} placeholder="Your password" />{register && <><label htmlFor="account-captcha">Security check</label><div className="anon-captcha-row">{captchaUrl ? <img src={captchaUrl} alt="Security check characters" /> : <span>Loading...</span>}<button type="button" className="anon-icon" title="Refresh security check" aria-label="Refresh security check" onClick={refresh}><RefreshCw size={17} /></button></div><input id="account-captcha" required maxLength={10} autoComplete="off" value={captcha} onChange={event => setCaptcha(event.target.value)} placeholder="Enter the characters above" /></>}<button className="anon-primary" disabled={busy || (register && !captchaUrl)}>{busy ? 'Please wait...' : register ? 'Create account' : 'Sign in'}<ArrowRight size={16} /></button></form>{!admin && <><div className="account-auth-benefit"><History size={15} /><span>Account history is kept for 30 days. Clear it whenever you choose.</span></div><p className="account-auth-switch">{register ? 'Already have an account?' : 'New around here?'} <Link to={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create an account'}</Link></p><Link className="anon-back-link" to="/"><Shield size={14} />Continue anonymously instead</Link></>}</div></main></div>;
}
