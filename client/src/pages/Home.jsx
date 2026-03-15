import React from 'react';
import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen text-center px-4 relative overflow-hidden">
      {/* Background shapes (ported from original CSS) */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[20%] left-[15%] w-[300px] h-[300px] bg-purple-600/20 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-[20%] right-[15%] w-[400px] h-[400px] bg-pink-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
      </div>
      
      <div className="z-10 bg-white/5 backdrop-blur-xl border border-white/10 p-10 rounded-3xl max-w-xl shadow-2xl">
        <h1 className="text-5xl font-bold bg-gradient-to-r from-pink-400 to-orange-400 bg-clip-text text-transparent mb-6">
          Welcome to ChatApp
        </h1>
        <p className="text-slate-300 text-lg mb-10">
          Connect with friends in real-time. Fast, secure, and beautifully designed.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link to="/login" className="px-8 py-3 rounded-xl bg-gradient-to-r from-pink-500 to-orange-400 text-white font-semibold hover:scale-105 transition-transform shadow-lg shadow-pink-500/30">
            Login Now
          </Link>
          <Link to="/register" className="px-8 py-3 rounded-xl bg-white/10 text-white font-semibold hover:bg-white/20 transition-colors border border-white/10">
            Create Account
          </Link>
        </div>
      </div>
    </div>
  );
}
