import React, { useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { ThemeProvider } from '../context/ThemeContext';

// Pages
import Dashboard from '../pages/Dashboard';
import Login from '../pages/Login';
import Register from '../pages/Register';

// A wrapper for authenticated routes
const ProtectedRoute = ({ children }) => {
  const { token } = useContext(AuthContext);
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

// A wrapper for auth pages (redirects to dashboard if already logged in)
const PublicRoute = ({ children }) => {
  const { token } = useContext(AuthContext);
  if (token) {
    return <Navigate to="/" replace />;
  }
  return children;
};

export function AppRouter() {
  return (
    <BrowserRouter>
      {/* ThemeProvider needs to be inside the DOM but AuthContext should wrap everything. 
          AuthContext is in App.jsx now. */}
      <div className="min-h-screen bg-light-bg dark:bg-dark-bg text-light-text dark:text-dark-text font-sans transition-colors duration-200">
        <Routes>
          {/* Public Auth Routes */}
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
          
          {/* Protected Dashboard */}
          <Route 
            path="/" 
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            } 
          />
          
          {/* Catch-all redirect */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
