import React, { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { ArrowDown, ArrowRight, ChevronDown, Download, Flag, History, LogOut, Menu, MessageCircle, MessageSquare, RefreshCw, Send, Shield, ShieldOff, Shuffle, Smile, Trash2, UserRound, Users, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import '../anonymous.css';

const HISTORY_KEY = 'clipmanz_anonymous_history';
const SAVE_KEY = 'clipmanz_save_history';
const EmojiMenu = lazy(() => import('../components/EmojiMenu'));
const DEFAULT_ROOMS = [
  { id: 'lounge', name: 'The lounge', topic: 'A little bit of everything', image: '/rooms/lounge.jpg', online: 0 },
  { id: 'music', name: 'Music', topic: 'On repeat, on stage, on your mind', image: '/rooms/music.jpg', online: 0 },
  { id: 'games', name: 'Games & tech', topic: 'New worlds and good ideas', image: '/rooms/games.jpg', online: 0 },
  { id: 'life', name: 'Everyday life', topic: 'Small wins and real conversations', image: '/rooms/life.jpg', online: 0 }
];
function readSaved() {
  try {
    const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(data) ? data.filter(message => typeof message?.message === 'string').slice(-500) : [];
  } catch { return []; }
}
function IconButton({ label, children, ...props }) {
  return <button type="button" className="anon-icon" aria-label={label} title={label} {...props}>{children}</button>;
}
function BlockToggle({ alias, blocked, disabled, onChange }) {
  return <button type="button" role="switch" className={`anon-block-toggle ${blocked ? 'is-blocked' : 'is-allowed'}`} aria-label={`Allow messages from ${alias}`} aria-checked={!blocked} title={`${blocked ? 'Blocked: unblock' : 'Unblocked: block'} ${alias}`} disabled={disabled} onClick={onChange}><span className="anon-block-track"><span /></span></button>;
}

export default function AnonymousChat({ accountMode = false }) {
  const navigate = useNavigate();
  const [accountToken] = useState(() => { try { return JSON.parse(localStorage.getItem('chat_user'))?.token; } catch { return null; } });
  const [guest, setGuest] = useState(null);
  const [rooms, setRooms] = useState(DEFAULT_ROOMS);
  const [room, setRoom] = useState('lounge');
  const [mode, setMode] = useState('rooms');
  const [connection, setConnection] = useState('loading');
  const [members, setMembers] = useState([]);
  const [blockedGuests, setBlockedGuests] = useState([]);
  const [roomJoined, setRoomJoined] = useState(false);
  const [partner, setPartner] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [matchState, setMatchState] = useState('idle');
  const [messages, setMessages] = useState([]);
  const [saved, setSaved] = useState(() => accountMode ? [] : readSaved());
  const [saveHistory, setSaveHistory] = useState(() => { if (accountMode) return true; try { return localStorage.getItem(SAVE_KEY) === 'true'; } catch { return false; } });
  const [draft, setDraft] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);
  const [captcha, setCaptcha] = useState('');
  const [captchaUrl, setCaptchaUrl] = useState('');
  const [starting, setStarting] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [reportReason, setReportReason] = useState('harassment');
  const [nearBottom, setNearBottom] = useState(true);
  const [newMessages, setNewMessages] = useState(0);
  const socketRef = useRef(null);
  const sendIdRef = useRef(null);
  const scrollRef = useRef(null);
  const draftRef = useRef(null);
  const emojiMenuRef = useRef(null);
  const emojiButtonRef = useRef(null);
  const emojiCaretRef = useRef(null);
  const saveRef = useRef(saveHistory);
  const contextRef = useRef({ mode, room });
  const bottomRef = useRef(true);
  const modalRef = useRef(null);
  saveRef.current = saveHistory;
  contextRef.current = { mode, room };
  const activeRoom = rooms.find(item => item.id === room) || rooms[0];
  const sidebarPeople = mode === 'rooms' ? members : partner ? [guest, partner].filter(Boolean) : [];
  const visibleMessages = messages.filter(message => message.conversation === (mode === 'rooms' ? `room:${room}` : conversation) && !blockedGuests.some(guest => guest.id === message.sender));
  const enabled = guest && connection === 'connected' && (mode === 'rooms' ? roomJoined : matchState === 'matched');

  useEffect(() => { setEmojiOpen(false); }, [mode, room, conversation, dialog, enabled]);
  useLayoutEffect(() => {
    if (emojiCaretRef.current === null) return;
    draftRef.current?.focus();
    draftRef.current?.setSelectionRange(emojiCaretRef.current, emojiCaretRef.current);
    emojiCaretRef.current = null;
  }, [draft, emojiOpen]);
  useEffect(() => {
    if (!emojiOpen) return;
    const dismiss = event => {
      if (!emojiMenuRef.current?.contains(event.target) && !emojiButtonRef.current?.contains(event.target)) setEmojiOpen(false);
    };
    const escape = event => {
      if (event.key === 'Escape') { event.preventDefault(); setEmojiOpen(false); emojiButtonRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape, true); };
  }, [emojiOpen]);

  const insertEmoji = emoji => {
    const input = draftRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? start;
    const updated = draft.slice(0, start) + emoji + draft.slice(end);
    if (updated.length > 2000) { setError('Your message is too long to add this emoji.'); return; }
    emojiCaretRef.current = start + emoji.length;
    setDraft(updated);
    setEmojiOpen(false);
  };

  useEffect(() => {
    let cancelled = false;
    if (accountMode && !accountToken) { navigate('/login', { replace: true }); return; }
    fetch(accountMode ? '/api/account/session' : '/api/anonymous/session', { credentials: 'include', headers: accountMode ? { Authorization: `Bearer ${accountToken}` } : {} }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to open chat.');
      if (!cancelled) { setGuest(data.guest); setRooms(data.rooms); setConnection(data.guest ? 'connecting' : 'guest'); }
    }).catch(err => { if (!cancelled) { setError(err.message); setConnection('guest'); if (accountMode) navigate('/login', { replace: true }); } });
    if (accountMode) fetch('/api/account/history', { headers: { Authorization: `Bearer ${accountToken}` } }).then(async response => {
      if (!response.ok) throw new Error('Unable to load account history.');
      const history = await response.json();
      if (!cancelled) { setMessages(history); setSaved(history); }
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (accountMode || guest || connection === 'loading') return;
    let cancelled = false;
    let url;
    fetch('/api/captcha', { credentials: 'include' }).then(async response => {
      if (!response.ok) throw new Error('Unable to load the security check.');
      url = URL.createObjectURL(await response.blob());
      if (cancelled) URL.revokeObjectURL(url); else setCaptchaUrl(url);
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [guest, connection === 'loading']);

  const refreshCaptcha = async () => {
    try {
      const response = await fetch('/api/captcha', { credentials: 'include' });
      if (!response.ok) throw new Error('Unable to refresh the security check.');
      const url = URL.createObjectURL(await response.blob());
      setCaptchaUrl(previous => { if (previous) URL.revokeObjectURL(previous); return url; });
      setCaptcha('');
    } catch (err) { setError(err.message); }
  };

  useEffect(() => {
    if (!guest) return;
    const socket = io('/anonymous', { withCredentials: true, autoConnect: false, auth: accountMode ? { token: accountToken } : {} });
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnection('connected');
      setRoomJoined(false);
      setError('');
      if (contextRef.current.mode === 'rooms') {
        socket.timeout(5000).emit('join_room', { room: contextRef.current.room }, (err, reply) => {
          if (err || !reply?.ok) setError(reply?.message || 'Unable to join the room.');
          else setRoomJoined(true);
        });
      } else { setMatchState('idle'); setPartner(null); setConversation(null); }
    });
    socket.on('ready', data => { setRooms(data.rooms); setBlockedGuests(data.blocked || []); setGuest(previous => previous?.id === data.guest.id ? previous : data.guest); });
    socket.on('blocked_guests', setBlockedGuests);
    socket.on('rooms', setRooms);
    socket.on('presence', setMembers);
    socket.on('matched', data => {
      setPartner(data.partner); setConversation(data.conversation); setMatchState('matched'); setDraft('');
      setNotice('You are connected. Say hello.');
    });
    socket.on('partner_left', () => { setPartner(null); setMatchState('ended'); setNotice('The other guest left the conversation.'); });
    socket.on('chat_message', message => {
      setMessages(previous => [...previous, message].slice(-500));
      if (!bottomRef.current) setNewMessages(value => value + 1);
      if (saveRef.current) setSaved(previous => [...previous, message].slice(-500));
    });
    socket.on('connect_error', err => {
      setError(err.message);
      setConnection('offline');
      if (err.message.includes('expired or suspended')) { socket.disconnect(); setGuest(null); setConnection('guest'); }
      if (accountMode && err.message.includes('expired or suspended')) { localStorage.removeItem('chat_user'); navigate('/login', { replace: true }); }
    });
    socket.on('disconnect', reason => {
      setRoomJoined(false);
      setConnection('offline'); setMembers([]); setPartner(null); setMatchState('idle');
      if (reason === 'io server disconnect') { setGuest(null); setConnection('guest'); setError('Your session ended.'); if (accountMode) { localStorage.removeItem('chat_user'); navigate('/login', { replace: true }); } }
    });
    socket.on('suspended', () => setError('This guest session has been suspended by a moderator.'));
    socket.io.on('reconnect_attempt', () => setConnection('connecting'));
    socket.connect();
    return () => { socket.removeAllListeners(); socket.io.removeAllListeners(); socket.disconnect(); socketRef.current = null; };
  }, [guest?.id]);

  useEffect(() => {
    if (accountMode) return;
    try {
      localStorage.setItem(SAVE_KEY, String(saveHistory));
      if (saveHistory) localStorage.setItem(HISTORY_KEY, JSON.stringify(saved));
      else localStorage.removeItem(HISTORY_KEY);
    } catch { setError('This browser cannot save history. Export a copy instead.'); }
  }, [saved, saveHistory]);

  useEffect(() => {
    if (nearBottom) {
      const container = scrollRef.current;
      if (container) container.scrollTop = visibleMessages.length ? container.scrollHeight : 0;
      setNewMessages(0);
    }
  }, [messages, nearBottom, room, conversation]);

  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement;
    const modal = modalRef.current;
    modal?.querySelector('button, select, input')?.focus();
    const handleKey = event => {
      if (event.key === 'Escape') setDialog(null);
      if (event.key !== 'Tab') return;
      const elements = [...modal.querySelectorAll('button, select, input, a[href]')].filter(element => !element.disabled);
      if (!elements.length) return;
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, [dialog]);

  const command = (event, data, callback) => {
    if (!socketRef.current?.connected) { setError('You are offline. Please reconnect first.'); return; }
    setError('');
    socketRef.current.timeout(6000).emit(event, data, (err, reply) => {
      if (err || !reply?.ok) { setError(reply?.message || 'The request timed out. Please try again.'); callback?.(false); }
      else callback?.(true, reply);
    });
  };
  const selectRoom = selected => {
    setDrawer(false);
    if (!guest) { setRoom(selected); setMode('rooms'); return; }
    command('join_room', { room: selected }, ok => {
      if (ok) { setRoom(selected); setMode('rooms'); setRoomJoined(true); setPartner(null); setMatchState('idle'); setDraft(''); setNotice(''); setNearBottom(true); }
    });
  };
  const selectMode = selected => {
    if (selected === mode) return;
    if (selected === 'rooms') { selectRoom(room); return; }
    if (guest) command('leave_chat', {}, ok => { if (ok) { setMode('random'); setMatchState('idle'); setPartner(null); setNotice(''); setDraft(''); } });
    else setMode('random');
  };
  const startGuest = async event => {
    event.preventDefault(); setStarting(true); setError('');
    try {
      const response = await fetch('/api/anonymous/session', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ captcha }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to start your guest session.');
      setGuest(data.guest); setRooms(data.rooms); setConnection('connecting'); setCaptcha('');
    } catch (err) { setError(err.message); refreshCaptcha(); }
    finally { setStarting(false); }
  };
  const send = event => {
    event.preventDefault();
    if (!enabled || sending || !draft.trim()) return;
    const text = draft;
    const context = mode === 'rooms' ? `room:${room}` : conversation;
    if (sendIdRef.current?.text !== text || sendIdRef.current?.context !== context) {
      sendIdRef.current = { text, context, id: crypto.randomUUID() };
    }
    setSending(true);
    command('send_message', { message: text, clientId: sendIdRef.current.id }, ok => {
      setSending(false);
      if (ok) { sendIdRef.current = null; setDraft(previous => previous === text ? '' : previous); draftRef.current?.focus(); }
    });
  };
  const findPartner = () => command('find_partner', {}, (ok, reply) => {
    if (ok && reply.state === 'waiting') { setMatchState('waiting'); setPartner(null); setConversation(null); setNotice(''); }
  });
  const toggleSave = () => {
    if (accountMode) { setDialog({ type: 'history' }); return; }
    if (saveHistory) setDialog({ type: 'disable-history' });
    else { setSaveHistory(true); setNotice('New messages will be saved on this device.'); }
  };
  const clearHistory = async () => {
    if (accountMode) {
      try {
        const response = await fetch('/api/account/history', { method: 'DELETE', headers: { Authorization: `Bearer ${accountToken}` } });
        if (!response.ok) throw new Error('Unable to clear account history.');
      } catch (err) { setError(err.message); return; }
    }
    setSaved([]); setMessages([]); setDialog(null); setNotice(accountMode ? 'Your account history was cleared.' : 'History cleared from this device.');
  };
  const exportHistory = () => {
    const transcript = saved.map(message => `[${message.timestamp}] ${message.alias}: ${message.message}`).join('\n');
    const url = URL.createObjectURL(new Blob([transcript], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'clipmanz-history.txt'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const endSession = async () => {
    if (accountMode) { socketRef.current?.disconnect(); localStorage.removeItem('chat_user'); navigate('/login'); return; }
    try {
      const response = await fetch('/api/anonymous/session', { method: 'DELETE', credentials: 'include' });
      if (!response.ok) throw new Error('Unable to end this session.');
      setGuest(null); setMessages([]); setPartner(null); setMembers([]); setMatchState('idle'); setConnection('guest'); setDialog(null);
    } catch (err) { setError(err.message); }
  };
  const report = () => command('report_message', { messageId: dialog.message.id, reason: reportReason }, ok => {
    if (ok) { setDialog(null); setNotice('Report submitted for moderator review.'); }
  });
  const blockGuest = target => command('block_guest', { guest: target }, ok => {
    if (ok) { setNotice('Guest blocked. You can unblock them in chat settings.'); setDialog(null); if (mode === 'random') { setPartner(null); setMatchState('ended'); } }
  });
  const unblockGuest = target => command('unblock_guest', { guest: target }, ok => {
    if (ok) setNotice('Guest unblocked. Their new messages and random matches are allowed again.');
  });
  const scrollToBottom = () => { setNearBottom(true); bottomRef.current = true; setNewMessages(0); };

  return (
    <div className="anonymous-app">
      <header className="anon-topbar">
        <div className="anon-brand"><MessageCircle size={26} strokeWidth={2.5} /><h1>clipmanz<span>.</span></h1><span className="anon-brand-label">a place to talk</span></div>
        <div className="anon-top-actions"><div className="anon-account-choice" aria-label="Identity mode"><Link to="/" className={!accountMode ? 'is-selected' : ''}><Shield size={13} />Guest</Link><Link to="/account-chat" className={accountMode ? 'is-selected' : ''}><UserRound size={13} />Account</Link></div><span className={`anon-status ${connection === 'connected' ? 'is-live' : ''}`}><span />{connection === 'connected' ? 'Connected' : connection === 'loading' || connection === 'connecting' ? 'Connecting' : guest ? 'Offline' : 'Guest chat'}</span><IconButton label="Privacy and community rules" onClick={() => setDialog({ type: 'privacy' })}><Shield size={18} /></IconButton></div>
      </header>
      <div className="anon-workspace">
        {drawer && <button className="anon-drawer-backdrop" aria-label="Close rooms" onClick={() => setDrawer(false)} />}
        <aside className={`anon-sidebar ${drawer ? 'is-open' : ''}`} aria-label="Chat navigation">
          <div className="anon-sidebar-heading"><span>YOUR NEXT CONVERSATION</span><IconButton label="Close rooms" onClick={() => setDrawer(false)}><X size={18} /></IconButton></div>
          <div className="anon-modes" aria-label="Chat mode"><button className={mode === 'rooms' ? 'is-selected' : ''} onClick={() => selectMode('rooms')}><Users size={16} /> Rooms</button><button className={mode === 'random' ? 'is-selected' : ''} onClick={() => { selectMode('random'); setDrawer(false); }}><Shuffle size={16} /> 1-on-1</button></div>
          <div className="anon-section-label">OPEN ROOMS <span>{rooms.length}</span></div>
          <nav className="anon-room-list" aria-label="Topic rooms">{rooms.map(item => <button key={item.id} className={`anon-room ${mode === 'rooms' && room === item.id ? 'is-selected' : ''}`} onClick={() => selectRoom(item.id)}><img src={item.image} alt="" /><span><strong>{item.name}</strong><small>{item.online} online</small></span>{mode === 'rooms' && room === item.id && <span className="anon-room-marker" />}</button>)}</nav>
          <div className="anon-sidebar-bottom"><div className="anon-identity-avatar">{guest ? guest.alias.slice(0, 1) : '?'}</div><div><strong>{guest?.alias || 'Your next identity'}</strong><small>{accountMode ? 'Member account' : guest ? 'Temporary guest' : 'No account needed'}</small></div>{guest && <IconButton label={accountMode ? 'Sign out' : 'End guest session'} onClick={() => setDialog({ type: 'end-session' })}><LogOut size={17} /></IconButton>}</div>
        </aside>
        <main className="anon-chat">
          <header className="anon-chat-heading"><IconButton label="Open rooms" className="anon-icon anon-mobile-menu" onClick={() => setDrawer(true)}><Menu size={20} /></IconButton><div className="anon-chat-heading-text"><h2>{mode === 'rooms' ? activeRoom.name : partner ? partner.alias : 'A conversation with someone new'}</h2><p>{mode === 'rooms' ? activeRoom.topic : matchState === 'waiting' ? 'Looking for another guest...' : matchState === 'matched' ? partner?.account ? 'Account participant: conversation history is saved' : 'Just the two of you' : 'One guest. One conversation. See where it goes.'}</p></div><div className="anon-chat-heading-actions">{mode === 'rooms' ? <span className="anon-member-count"><Users size={15} />{members.length}</span> : guest && <IconButton label={matchState === 'waiting' ? 'Cancel search' : 'Leave conversation'} disabled={matchState === 'idle'} onClick={() => command('leave_chat', {}, ok => { if (ok) { setMatchState('idle'); setPartner(null); setNotice(''); } })}><X size={18} /></IconButton>}<IconButton label="Saved history" onClick={() => setDialog({ type: 'history' })}><History size={18} /></IconButton><IconButton label="History settings" onClick={() => setDialog({ type: 'settings' })}><ChevronDown size={18} /></IconButton></div></header>
          {error && <div className="anon-feedback is-error" role="alert">{error}<IconButton label="Dismiss error" onClick={() => setError('')}><X size={15} /></IconButton></div>}
          {notice && <div className="anon-feedback" role="status">{notice}<IconButton label="Dismiss notification" onClick={() => setNotice('')}><X size={15} /></IconButton></div>}
          <div className="anon-message-scroll" ref={scrollRef} onScroll={event => { const element = event.currentTarget; const close = element.scrollHeight - element.scrollTop - element.clientHeight < 100; bottomRef.current = close; setNearBottom(close); }}>
            {!guest ? <div className="anon-entry"><div className="anon-entry-icon"><MessageSquare size={32} /></div><span className="anon-eyebrow">A FRESH START</span><h3>A new name.<br />A real conversation.</h3><p>Join as a guest. No email, no profile, no introductions required.</p><form onSubmit={startGuest}><label htmlFor="guest-captcha">Security check</label><div className="anon-captcha-row">{captchaUrl ? <img src={captchaUrl} alt="Security check characters" /> : <span>Loading...</span>}<IconButton label="Refresh security check" onClick={refreshCaptcha}><RefreshCw size={17} /></IconButton></div><input id="guest-captcha" value={captcha} onChange={event => setCaptcha(event.target.value)} placeholder="Enter the characters above" autoComplete="off" required maxLength={10} /><button className="anon-primary" type="submit" disabled={starting || !captchaUrl || connection === 'loading'}>{starting ? 'Joining...' : 'Start a conversation'}<ArrowRight size={18} /></button></form><p className="anon-entry-note">By joining, you agree to the <button onClick={() => setDialog({ type: 'privacy' })}>community rules</button>.</p></div> : <>
              {visibleMessages.length === 0 && <div className="anon-empty"><div className="anon-empty-icon">{mode === 'rooms' ? <MessageCircle size={30} /> : <Shuffle size={30} />}</div><h3>{mode === 'rooms' ? 'Make yourself at home.' : matchState === 'waiting' ? 'Good conversations take a moment.' : matchState === 'matched' ? 'Someone new is here.' : 'Meet someone outside your usual circle.'}</h3><p>{mode === 'rooms' ? 'You are here as ' + guest.alias + '. Say hello to the room.' : matchState === 'waiting' ? 'Keep this tab open. We will connect you when another guest is ready.' : matchState === 'matched' ? 'Start with a hello. Share only what you are comfortable sharing.' : 'Get paired with another guest for a private text conversation.'}</p>{mode === 'random' && ['idle', 'ended'].includes(matchState) && <button className="anon-primary" onClick={findPartner} disabled={connection !== 'connected'}><Shuffle size={17} />Find a conversation</button>}{mode === 'random' && matchState === 'waiting' && <div className="anon-waiting" aria-label="Searching"><span /><span /><span /></div>}</div>}
              {visibleMessages.map((message, index) => {
                const own = message.sender === guest.id;
                const previous = visibleMessages[index - 1];
                const grouped = previous?.sender === message.sender && new Date(message.timestamp) - new Date(previous.timestamp) < 120000;
                const date = new Date(message.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                const newDate = !previous || new Date(previous.timestamp).toDateString() !== new Date(message.timestamp).toDateString();
                return <React.Fragment key={message.id}>{newDate && <div className="anon-date"><span>{date}</span></div>}<article className={`anon-message ${own ? 'is-own' : ''} ${grouped ? 'is-grouped' : ''}`}><div className="anon-message-avatar" aria-hidden="true">{!grouped && message.alias.slice(0, 1)}</div><div className="anon-message-body">{!grouped && <div className="anon-message-meta"><strong>{own ? 'You' : message.alias}</strong><time dateTime={message.timestamp}>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>}<div className="anon-bubble">{message.message}</div></div>{!own && <IconButton label={`Report message from ${message.alias}`} onClick={() => { setReportReason('harassment'); setDialog({ type: 'report', message }); }}><Flag size={14} /></IconButton>}</article></React.Fragment>;
              })}
              {mode === 'random' && matchState === 'ended' && visibleMessages.length > 0 && <div className="anon-conversation-ended"><p>This conversation has ended.</p><button className="anon-primary" onClick={findPartner} disabled={connection !== 'connected'}><Shuffle size={16} />Find someone new</button></div>}
            </>}
          </div>
          {newMessages > 0 && !nearBottom && <button className="anon-new-messages" onClick={scrollToBottom}><ArrowDown size={15} />{newMessages} new messages</button>}
          <footer className="anon-composer">{emojiOpen && <div id="chat-emoji-picker" className="anon-emoji-popover" ref={emojiMenuRef} role="dialog" aria-label="Emoji picker"><Suspense fallback={<div className="anon-emoji-loading" role="status">Loading emojis...</div>}><EmojiMenu onSelect={insertEmoji} /></Suspense></div>}<form onSubmit={send}><textarea ref={draftRef} aria-label="Message" placeholder={!guest ? 'Join as a guest to start chatting' : connection !== 'connected' ? 'Waiting for connection...' : mode === 'random' && matchState !== 'matched' ? 'Find a conversation to start chatting' : 'Write a message...'} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(event); } }} maxLength={2000} rows={1} disabled={!enabled} /><button ref={emojiButtonRef} type="button" className="anon-icon" aria-label="Add emoji" title="Add emoji" aria-expanded={emojiOpen} aria-controls="chat-emoji-picker" disabled={!enabled} onClick={() => setEmojiOpen(open => !open)}><Smile size={20} /></button><button type="submit" className="anon-send" aria-label="Send message" title="Send message" disabled={!enabled || sending || !draft.trim()}><Send size={19} /></button></form><div className="anon-composer-meta"><span><Shield size={12} />{accountMode ? 'Saved to your account for 30 days' : saveHistory ? 'Saving on this device' : 'History saving is off'}</span><span>{draft.length}/2000</span></div></footer>
        </main>
        <aside className="anon-details" aria-label="Room members and community">
          <section className="anon-people">
            <span className="anon-section-label">{mode === 'rooms' ? 'IN THIS ROOM' : 'THIS CONVERSATION'}<span>{sidebarPeople.length}</span></span>
            <div className="anon-member-list">{sidebarPeople.map(member => <div key={member.id}><span className="anon-small-avatar">{member.alias.slice(0, 1)}</span><span>{member.id === guest?.id ? `${member.alias} (you)` : member.alias}</span>{member.id !== guest?.id && <BlockToggle alias={member.alias} blocked={blockedGuests.some(item => item.id === member.id)} disabled={connection !== 'connected'} onChange={() => blockedGuests.some(item => item.id === member.id) ? unblockGuest(member.id) : blockGuest(member.id)} />}</div>)}{sidebarPeople.length === 0 && <p>{mode === 'rooms' ? 'No guests connected yet.' : 'Find a conversation to meet someone new.'}</p>}</div>
          </section>
          <section className="anon-kindness">
            <h3>A little kindness goes a long way.</h3>
            <p>Respect the person behind the name. Keep personal details private. Block or report anyone who crosses a line.</p>
            <button className="anon-text-action" onClick={() => setDialog({ type: 'privacy' })}>Privacy & community rules<ArrowRight size={14} /></button>
            <button className="anon-text-action" disabled={!guest} onClick={() => setDialog({ type: 'blocked' })}><ShieldOff size={15} />Blocked guests ({blockedGuests.length})<ArrowRight size={14} /></button>
          </section>
        </aside>
      </div>
      {dialog && <div className="anon-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDialog(null); }}><div className="anon-modal" role="dialog" aria-modal="true" aria-labelledby="anon-dialog-title" ref={modalRef}><div className="anon-modal-heading"><h2 id="anon-dialog-title">{({ history: accountMode ? 'Your account history' : 'Saved on this device', settings: 'Your history', privacy: 'Privacy & community rules', report: 'Report this message', blocked: 'Blocked guests', 'end-session': accountMode ? 'Sign out of your account?' : 'End your guest session?', 'disable-history': 'Turn off saved history?', 'clear-history': 'Clear your history?' })[dialog.type]}</h2><IconButton label="Close dialog" onClick={() => setDialog(null)}><X size={19} /></IconButton></div>
        {dialog.type === 'privacy' && <div className="anon-policy"><h3>Temporary identity, honest privacy.</h3><p>No account or email is required. Guest sessions last up to 24 hours. Guest history is not stored for your guest session. If you turn on guest history, new messages are saved in this browser until you delete them. Account participants retain received messages on the server for 30 days, including messages from guests.</p><p>Other guests can copy messages or save their own history. Turning off your history does not remove their copies. Reports include the selected message for moderation and are deleted after seven days. Server access logs may contain IP addresses. This chat is not end-to-end encrypted.</p><h3>Keep it human.</h3><p>No harassment, threats, hate, sexual exploitation, scams or spam. Do not share someone else's personal information. Moderators can suspend guest sessions. Reports are reviewed by moderators, not an emergency service.</p><p>Share only what you are comfortable sharing. Block unwanted contact and report harmful messages using the flag beside them.</p></div>}
        {dialog.type === 'settings' && <><div className="anon-setting-heading"><h3>{accountMode ? 'Account history is on' : 'Save history on this device'}</h3><button className={`anon-toggle ${saveHistory ? 'is-on' : ''}`} role="switch" aria-checked={saveHistory} aria-label={accountMode ? 'View account history' : 'Save history on this device'} onClick={toggleSave}><span /></button></div><p>{accountMode ? 'Received messages are saved to your account for 30 days. Clearing your history does not remove copies saved by other participants.' : 'Saving applies to new messages only. Other participants, including account users, can save their own copies. This device may be shared with other people.'}</p><button className="anon-text-action" onClick={() => setDialog({ type: 'history' })}><History size={16} />View saved history</button><button className="anon-text-action" disabled={!guest} onClick={() => setDialog({ type: 'blocked' })}><ShieldOff size={16} />Blocked guests ({blockedGuests.length})<ArrowRight size={14} /></button></>}
        {dialog.type === 'history' && <><p>{saved.length} saved messages. {accountMode ? 'Stored with your account for up to 30 days.' : 'Available only in this browser.'}</p><div className="anon-history-list">{saved.length ? saved.map(message => <article key={message.id}><small>{message.alias} · {new Date(message.timestamp).toLocaleString()}</small><p>{message.message}</p></article>) : <div className="anon-history-empty"><History size={28} /><p>No saved messages yet.</p></div>}</div><div className="anon-modal-actions"><button className="anon-secondary" disabled={!saved.length} onClick={exportHistory}><Download size={16} />Export</button><button className="anon-secondary is-danger" disabled={!saved.length && !messages.length} onClick={() => setDialog({ type: 'clear-history' })}><Trash2 size={16} />Clear history</button></div></>}
        {dialog.type === 'report' && <><blockquote>{dialog.message.message}</blockquote><label htmlFor="report-reason">Reason</label><select id="report-reason" value={reportReason} onChange={event => setReportReason(event.target.value)}><option value="harassment">Harassment or hate</option><option value="spam">Spam or scam</option><option value="sexual">Sexual or exploitative content</option><option value="threats">Threats or violence</option><option value="other">Something else</option></select><p>The selected message will be kept for moderator review for up to seven days.</p><div className="anon-modal-actions"><div className="anon-contact-setting"><span>Allow messages</span><BlockToggle alias={dialog.message.alias} blocked={blockedGuests.some(item => item.id === dialog.message.sender)} disabled={connection !== 'connected'} onChange={() => blockedGuests.some(item => item.id === dialog.message.sender) ? unblockGuest(dialog.message.sender) : blockGuest(dialog.message.sender)} /></div><button className="anon-primary" onClick={report}><Flag size={16} />Submit report</button></div></>}
        {dialog.type === 'blocked' && <><p>Blocked identities are muted and excluded from your random matches. Unblocking allows future messages and matches; it does not restart a conversation.</p><div className="anon-blocked-list">{blockedGuests.length ? blockedGuests.map(item => <div className="anon-blocked-row" key={item.id}><span className="anon-small-avatar">{item.alias.slice(0, 1)}</span><strong>{item.alias}</strong><BlockToggle alias={item.alias} blocked disabled={connection !== 'connected'} onChange={() => unblockGuest(item.id)} /></div>) : <div className="anon-history-empty"><Shield size={28} /><p>No blocked guests.</p></div>}</div></>}
        {dialog.type === 'end-session' && <><p>{accountMode ? 'Your current conversation will end. Saved history remains in your account until you clear it or it expires.' : 'Your current conversation will end and unsaved messages will disappear from this tab. Saved history remains on this device until you clear it.'}</p><div className="anon-modal-actions"><button className="anon-secondary" onClick={() => setDialog(null)}>Keep chatting</button><button className="anon-primary" onClick={endSession}><LogOut size={16} />{accountMode ? 'Sign out' : 'End session'}</button></div></>}
        {dialog.type === 'disable-history' && <><p>This deletes previously saved anonymous history from this browser and stops saving new messages. Messages currently visible in this tab remain until you leave or clear them.</p><div className="anon-modal-actions"><button className="anon-secondary" onClick={() => setDialog(null)}>Cancel</button><button className="anon-primary" onClick={() => { setSaveHistory(false); setSaved([]); setDialog(null); }}><Trash2 size={16} />Delete & turn off</button></div></>}
        {dialog.type === 'clear-history' && <><p>{accountMode ? 'Your server-saved history and currently displayed messages will be removed.' : 'Saved and currently displayed messages will be removed from this device.'} This does not delete copies saved by other participants.</p><div className="anon-modal-actions"><button className="anon-secondary" onClick={() => setDialog(null)}>Cancel</button><button className="anon-primary" onClick={clearHistory}><Trash2 size={16} />Clear history</button></div></>}
      </div></div>}
    </div>
  );
}
