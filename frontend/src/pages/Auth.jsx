import { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { AuthContext } from '../context/AuthContext';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const navigate = useNavigate();
  const { login } = useContext(AuthContext);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (isLogin) {
        const data = await api.login(email, password);
        login(data.access_token);
        navigate('/chat');
      } else {
        const data = await api.register(email, password);
        login(data.access_token);
        navigate('/chat');
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-black text-black dark:text-white p-4">
      <div className="max-w-sm w-full space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold">
            {isLogin ? 'Welcome back' : 'Create an account'}
          </h2>
        </div>
        
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 text-sm text-center border border-red-200 dark:border-red-800">
            {error}
          </div>
        )}

        <form className="space-y-6" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium mb-2">Email address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-black dark:border-gray-600 bg-transparent p-3 focus:outline-none focus:ring-1 focus:ring-black dark:focus:ring-white dark:text-white"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-black dark:border-gray-600 bg-transparent p-3 focus:outline-none focus:ring-1 focus:ring-black dark:focus:ring-white dark:text-white"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black dark:bg-white text-white dark:text-black font-medium py-3 px-4 hover:bg-gray-800 dark:hover:bg-gray-200 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:text-gray-200 dark:disabled:text-gray-400 transition-colors border border-transparent dark:border-white"
          >
            {loading ? 'Please wait...' : (isLogin ? 'Sign in' : 'Sign up')}
          </button>
        </form>

        <div className="text-center text-sm">
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white underline"
          >
            {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}
