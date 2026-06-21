/* eslint-disable react-refresh/only-export-components */
import { createContext, useState } from 'react';
import { jwtDecode } from 'jwt-decode';

export const AuthContext = createContext({
  user: null,
  token: null,
  login: () => {},
  logout: () => {},
});

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(() => localStorage.getItem('access_token'));

  let user = null;
  if (token) {
    try {
      const decoded = jwtDecode(token);
      user = { email: decoded.sub };
      localStorage.setItem('access_token', token);
    } catch (err) {
      console.error("Invalid token", err);
      localStorage.removeItem('access_token');
    }
  } else {
    localStorage.removeItem('access_token');
  }

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
