import axios from 'axios';

// Ensure the trailing slash is handled properly
const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');

const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export let fetchToken: string | (() => Promise<string | null> | string | null) | null = null;

export const setTokenFetcher = (fetcher: string | (() => Promise<string | null> | string | null)) => {
  fetchToken = fetcher;
};

// Request interceptor to inject NextAuth backend JWT token
apiClient.interceptors.request.use(async (config) => {
  if (fetchToken) {
    try {
      const token = typeof fetchToken === 'function' ? await fetchToken() : fetchToken;
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (err) {
      console.error("Failed to fetch token", err);
    }
  }
  return config;
});

export interface Citation {
  file_path: string;
  start_line: number;
  end_line: number;
}

export interface IngestStatusResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'not_found';
  progress: number;
  stage: string;
  step_details: string[];
  error?: string | null;
}

export const api = {
  checkHealth: async () => {
    const response = await apiClient.get('/health');
    return response.data;
  },

  getMe: async () => {
    const response = await apiClient.get('/api/v1/auth/me');
    return response.data;
  },

  ingestRepo: async (repoUrl: string) => {
    const response = await apiClient.post('/api/v1/ingestion/ingest', { repo_url: repoUrl });
    return response.data;
  },

  cancelIngestion: async (repoUrl: string) => {
    const response = await apiClient.post('/api/v1/ingestion/cancel', { repo_url: repoUrl });
    return response.data;
  },

  checkIngestionStatus: async (repoUrl: string): Promise<IngestStatusResponse> => {
    const response = await apiClient.get(`/api/v1/ingestion/status?repo_url=${encodeURIComponent(repoUrl)}`);
    return response.data;
  },

  askQuestion: async (question: string) => {
    const response = await apiClient.post('/api/v1/rag/ask', { question });
    return response.data;
  },

  askQuestionStream: async (
    question: string,
    repoUrl: string | undefined,
    ingestionProgress: number | null,
    onToken: (token: string) => void,
    onDone: (citations: Citation[]) => void,
    onError: (errorMsg: string) => void
  ) => {
    let token: string | null = null;
    if (fetchToken) {
      token = typeof fetchToken === 'function' ? await fetchToken() : fetchToken;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const body: any = { question, repo_url: repoUrl || undefined };
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

      if (!response.body) {
        onError('Empty response body');
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
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.token) onToken(parsed.token);
            if (parsed.done) onDone(parsed.citations || []);
          } catch { /* ignore malformed lines */ }
        }
      }
    } catch (err: any) {
      onError(err.message || 'Network error during streaming.');
    }
  },
};
