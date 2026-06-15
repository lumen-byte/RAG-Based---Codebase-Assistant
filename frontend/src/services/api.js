import axios from 'axios';

// Ensure the trailing slash is handled properly
const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');

const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to inject JWT token
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const api = {
  checkHealth: async () => {
    const response = await apiClient.get('/health');
    return response.data;
  },
  
  register: async (email, password) => {
    const response = await apiClient.post('/auth/register', { email, password });
    return response.data;
  },

  login: async (email, password) => {
    const formData = new URLSearchParams();
    formData.append('username', email);
    formData.append('password', password);
    const response = await apiClient.post('/auth/login', formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    return response.data;
  },
  
  ingestRepo: async (repoUrl) => {
    const response = await apiClient.post('/api/v1/ingestion/ingest', { repo_url: repoUrl });
    return response.data;
  },

  askQuestion: async (question) => {
    const response = await apiClient.post('/api/v1/rag/ask', { question });
    return response.data;
  },

  /**
   * Streaming version — calls the /ask/stream SSE endpoint.
   * Calls onToken(token) for each word/chunk as it arrives.
   * Calls onDone(citations) when the stream ends.
   */
  askQuestionStream: async (question, onToken, onDone, onError) => {
    const token = localStorage.getItem('access_token');
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    try {
      const response = await fetch(
        `${(import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')}/api/v1/rag/ask/stream`,
        { method: 'POST', headers, body: JSON.stringify({ question }) }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Server error' }));
        onError(err.detail || 'Server returned an error.');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.token) onToken(parsed.token);
            if (parsed.done) onDone(parsed.citations || []);
          } catch { /* ignore malformed lines */ }
        }
      }
    } catch (err) {
      onError(err.message || 'Network error during streaming.');
    }
  },
};
