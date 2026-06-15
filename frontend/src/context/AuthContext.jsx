import React, { createContext, useState, useEffect } from 'react';
import { jwtDecode } from 'jwt-decode';

export const AuthContext = createContext({
  user: null,
  token: null,
  login: (token) => {},
  logout: () => {},
});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('access_token'));

  useEffect(() => {
    if (token) {
      try {
        const decoded = jwtDecode(token);
        // The backend `create_access_token` sets `sub` to the user's email
        setUser({ email: decoded.sub });
        localStorage.setItem('access_token', token);
      } catch (err) {
        console.error("Invalid token", err);
        setToken(null);
        setUser(null);
        localStorage.removeItem('access_token');
      }
    } else {
      setUser(null);
      localStorage.removeItem('access_token');
    }
  }, [token]);

  const login = (newToken) => {
    setToken(newToken);
  };

  const logout = () => {
    setToken(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
