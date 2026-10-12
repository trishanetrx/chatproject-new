import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AnonymousChat from './pages/AnonymousChat';
import Login from './pages/Login';
import Register from './pages/Register';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AnonymousChat key="guest" />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/chat" element={<AnonymousChat key="guest" />} />
        <Route path="/account-chat" element={<AnonymousChat key="account" accountMode />} />
        <Route path="/admin" element={<AdminLogin />} />
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
