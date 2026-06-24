import axios from 'axios';

// Ensure the trailing slash is handled properly
const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');

const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export let fetchToken = null;

export const setTokenFetcher = (fetcher) => {
  fetchToken = fetcher;
};

// Request interceptor to inject Clerk JWT token
apiClient.interceptors.request.use(async (config) => {
  if (fetchToken) {
    try {
      const token = await fetchToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (err) {
      console.error("Failed to fetch Clerk token", err);
    }
  }
  return config;
});

export const api = {
  checkHealth: async () => {
    const response = await apiClient.get('/health');
    return response.data;
  },

  // Note: Register, Login, Refresh, and GoogleLogin are now handled entirely by Clerk on the frontend.
  // We keep getMe to fetch the user profile from our DB if needed, though Clerk provides useUser().
  getMe: async () => {
    const response = await apiClient.get('/auth/me');
    return response.data;
  },

  ingestRepo: async (repoUrl) => {
    const response = await apiClient.post('/api/v1/ingestion/ingest', { repo_url: repoUrl });
    return response.data;
  },

  checkIngestionStatus: async (repoUrl) => {
    const response = await apiClient.get(`/api/v1/ingestion/status?repo_url=${encodeURIComponent(repoUrl)}`);
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
  askQuestionStream: async (question, repoUrl, ingestionProgress, onToken, onDone, onError) => {
    let token = null;
    if (fetchToken) {
      token = await fetchToken();
    }

    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    try {
      const body = { question, repo_url: repoUrl || undefined };
      if (ingestionProgress !== null && ingestionProgress !== undefined) {
        body.ingestion_progress = ingestionProgress;
      }

      const response = await fetch(
        `${API_URL}/api/v1/rag/ask/stream`,
        { method: 'POST', headers, body: JSON.stringify(body) }
      );

      if (!response.ok) {
        if (response.status === 401) {
          onError('Session expired. Please log in again.');
          return;
        }
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
