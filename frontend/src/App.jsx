import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SignedIn, SignedOut, RedirectToSignIn, useAuth } from '@clerk/clerk-react';
import { useEffect } from 'react';

import Landing from './pages/Landing';
import Auth from './pages/Auth';
import Chat from './pages/Chat';
import { setTokenFetcher } from './services/api';

const ProtectedRoute = ({ children }) => {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut><RedirectToSignIn /></SignedOut>
    </>
  );
};

const PublicRoute = ({ children }) => {
  return (
    <>
      <SignedIn><Navigate to="/chat" replace /></SignedIn>
      <SignedOut>{children}</SignedOut>
    </>
  );
};

const AppContent = () => {
  const { getToken } = useAuth();
  
  useEffect(() => {
    setTokenFetcher(() => getToken());
  }, [getToken]);

  return (
    <Routes>
      <Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />
      <Route path="/auth/*" element={<PublicRoute><Auth /></PublicRoute>} />
      <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
