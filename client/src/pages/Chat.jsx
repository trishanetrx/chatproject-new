import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../api';

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [socket, setSocket] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const messagesEndRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const userStr = localStorage.getItem('chat_user');
    if (!userStr) {
      navigate('/login');
      return;
    }
    
    const user = JSON.parse(userStr);
    setCurrentUser(user);

    const newSocket = io(SOCKET_URL, {
      withCredentials: true
    });

    newSocket.on('connect', () => {
      newSocket.emit('join', user.username);
    });

    newSocket.on('chatHistory', (history) => {
      setMessages(history);
    });

    newSocket.on('message', (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    newSocket.on('system_broadcast', (msg) => {
      setMessages((prev) => [...prev, { ...msg, isSystem: true }]);
    });

    newSocket.on('private_message', (msg) => {
      setMessages((prev) => [...prev, { ...msg, isPrivate: true }]);
    });

    newSocket.on('updateUserList', (userList) => {
      setUsers(userList);
    });

    newSocket.on('banned', () => {
      alert("You have been banned.");
      localStorage.removeItem('chat_user');
      navigate('/login');
    });

    newSocket.on('kicked', () => {
      alert("You have been kicked.");
      localStorage.removeItem('chat_user');
      navigate('/login');
    });

    setSocket(newSocket);

    return () => newSocket.disconnect();
  }, [navigate]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (inputMessage.trim() && socket) {
      socket.emit('message', {
        username: currentUser.username,
        message: inputMessage,
        timestamp: new Date().toISOString()
      });
      setInputMessage('');
    }
  };

  const logout = () => {
    if (socket) socket.disconnect();
    localStorage.removeItem('chat_user');
    navigate('/login');
  };

  if (!currentUser) return null;

  return (
    <div className="flex h-screen bg-slate-900 overflow-hidden relative">
      <div className="absolute inset-0 z-0 bg-gradient-to-br from-slate-900 to-indigo-950"></div>
      
      {/* Sidebar for Users */}
      <aside className="w-64 bg-slate-800/80 backdrop-blur-md border-r border-white/5 flex flex-col z-10 transition-all">
        <div className="p-4 border-b border-white/5 bg-slate-900/50 flex justify-between items-center">
          <h2 className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-orange-400">Online Users</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {users.map(u => (
            <div key={u} className="flex items-center gap-3 p-3 rounded-lg hover:bg-white/5 transition-colors cursor-pointer">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-sm font-bold shadow-lg">
                {u.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 truncate font-medium text-slate-200">{u}</div>
              <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-white/5 bg-slate-900/50">
          <button 
            onClick={logout}
            className="w-full py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors font-medium border border-red-500/30"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col z-10 relative">
        <header className="h-16 bg-slate-800/80 backdrop-blur-md border-b border-white/5 flex items-center px-6 justify-between">
          <h1 className="font-bold text-lg text-white">Global Chat</h1>
          <div className="text-sm px-3 py-1 bg-white/10 rounded-full border border-white/10">
            Logged in as <span className="font-bold text-pink-400">{currentUser.username}</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((m, i) => {
            const isMe = m.username === currentUser.username;
            return (
              <div key={i} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                {!isMe && m.username !== "System" && <span className="text-xs text-slate-400 mb-1 ml-2">{m.username}</span>}
                <div className={`max-w-[75%] px-5 py-3 rounded-2xl ${
                  m.isSystem ? 'bg-amber-500/20 text-amber-200 border border-amber-500/30 rounded-lg self-center mx-auto text-sm' :
                  m.isPrivate ? 'bg-purple-600 border border-purple-400 rounded-bl-sm shadow-lg shadow-purple-600/20' :
                  isMe ? 'bg-gradient-to-r from-pink-500 to-orange-400 text-white rounded-br-sm shadow-lg shadow-pink-500/20' : 
                  'bg-white/10 backdrop-blur-md border border-white/5 text-slate-200 rounded-bl-sm'
                }`}>
                  <p className="break-words leading-relaxed">{m.message}</p>
                </div>
                {!m.isSystem && (
                  <span className={`text-[10px] text-slate-500 mt-1 ${isMe ? 'mr-2' : 'ml-2'}`}>
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-slate-800/80 backdrop-blur-md border-t border-white/5">
          <form onSubmit={sendMessage} className="flex gap-2 relative max-w-5xl mx-auto">
            <input 
              type="text" 
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="Type your message..."
              className="flex-1 bg-slate-900/50 border border-slate-700/50 rounded-full px-6 py-3 text-white focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
            />
            <button 
              type="submit"
              disabled={!inputMessage.trim()}
              className="bg-gradient-to-r from-pink-500 to-orange-400 text-white w-12 h-12 rounded-full flex justify-center items-center hover:scale-105 transition-transform shadow-lg shadow-pink-500/30 disabled:opacity-50 disabled:hover:scale-100"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 ml-1">
                <path d="M3.478 2.404a.75.75 0 00-.926.941l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.404z" />
              </svg>
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
