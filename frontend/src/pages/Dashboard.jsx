import React, { useState, useRef, useEffect, useContext } from 'react';
import { Send, User, Bot, Code2, AlertCircle, GitBranch, CheckCircle2, Activity, Database, Server, Brain, LogOut, Clock, Plus } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { api } from '../services/api';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { ThemeToggle } from '../components/common/ThemeToggle';

export default function Dashboard() {
  const { theme } = useContext(ThemeContext);
  const { user, logout } = useContext(AuthContext);

  // --- Chat State ---
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hello! I am CodeLens AI. Ask me anything about your ingested repository.' }
  ]);
  const [input, setInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // --- History State ---
  const [history, setHistory] = useState(() => {
    const saved = localStorage.getItem('chat_history');
    return saved ? JSON.parse(saved) : [];
  });
  const [currentSessionId, setCurrentSessionId] = useState(() => Date.now().toString());

  // --- Ingestion State ---
  const [repoUrl, setRepoUrl] = useState('');
  const [ingestStatus, setIngestStatus] = useState('idle');
  const [ingestResult, setIngestResult] = useState(null);
  const [ingestError, setIngestError] = useState('');

  // --- Health State ---
  const [healthData, setHealthData] = useState(null);
  const [isHealthLoading, setIsHealthLoading] = useState(true);

  // Initial Health Check
  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const data = await api.checkHealth();
        setHealthData(data);
      } catch (err) {
        setHealthData({ status: 'unavailable', services: { qdrant: 'unavailable', ollama: 'unavailable' } });
      } finally {
        setIsHealthLoading(false);
      }
    };
    fetchHealth();
    const interval = setInterval(fetchHealth, 60000); // Check every minute
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Save history on message change
  useEffect(() => {
    if (messages.length > 1) {
      setHistory(prev => {
        const existing = prev.find(h => h.id === currentSessionId);
        let updated;
        if (existing) {
          updated = prev.map(h => h.id === currentSessionId ? { ...h, messages } : h);
        } else {
          // New session title based on first user message
          const title = messages.find(m => m.role === 'user')?.content.substring(0, 30) + '...';
          updated = [{ id: currentSessionId, title: title || 'New Chat', messages, date: new Date().toISOString() }, ...prev];
        }
        localStorage.setItem('chat_history', JSON.stringify(updated));
        return updated;
      });
    }
  }, [messages, currentSessionId]);

  const startNewChat = () => {
    setMessages([{ role: 'assistant', content: 'Hello! I am CodeLens AI. Ask me anything about your ingested repository.' }]);
    setCurrentSessionId(Date.now().toString());
  };

  const loadHistory = (sessionId) => {
    const session = history.find(h => h.id === sessionId);
    if (session) {
      setMessages(session.messages);
      setCurrentSessionId(sessionId);
    }
  };

  // --- Handlers ---
  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isChatLoading) return;

    const userMessage = input.trim();
    setInput('');

    // Add user message immediately
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsChatLoading(true);

    // Add a placeholder assistant message that we'll stream tokens into
    const assistantMsgId = Date.now();
    setMessages(prev => [...prev, { role: 'assistant', content: '', id: assistantMsgId, isStreaming: true }]);

    await api.askQuestionStream(
      userMessage,
      // onToken: append each token to the assistant message
      (token) => {
        setMessages(prev => prev.map(m =>
          m.id === assistantMsgId
            ? { ...m, content: m.content + token }
            : m
        ));
      },
      // onDone: attach citations and mark as complete
      (citations) => {
        setMessages(prev => prev.map(m =>
          m.id === assistantMsgId
            ? { ...m, citations, isStreaming: false }
            : m
        ));
        setIsChatLoading(false);
      },
      // onError: show error in the assistant bubble
      (errorMsg) => {
        setMessages(prev => prev.map(m =>
          m.id === assistantMsgId
            ? { ...m, content: `**Error:** ${errorMsg}`, isError: true, isStreaming: false }
            : m
        ));
        setIsChatLoading(false);
      }
    );
  };

  const handleIngest = async (e) => {
    e.preventDefault();
    if (!repoUrl) return;

    setIngestStatus('loading');
    setIngestError('');
    setIngestResult(null);

    try {
      const data = await api.ingestRepo(repoUrl);
      setIngestResult(data);
      setIngestStatus('success');
    } catch (err) {
      setIngestError(err.response?.data?.detail || 'An unexpected error occurred.');
      setIngestStatus('error');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit(e);
    }
  };

  const StatusIcon = ({ status }) => {
    if (status === 'connected' || status === 'healthy') return <span className="h-2 w-2 rounded-full bg-green-500" />;
    if (status === 'degraded') return <span className="h-2 w-2 rounded-full bg-yellow-500" />;
    return <span className="h-2 w-2 rounded-full bg-red-500" />;
  };

  return (
    <div className="flex h-screen overflow-hidden">
      
      {/* LEFT SIDEBAR: Profile & History */}
      <aside className="w-64 border-r border-light-border dark:border-dark-border bg-light-surface dark:bg-dark-surface flex flex-col shrink-0">
        <div className="p-4 border-b border-light-border dark:border-dark-border flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-primary">
            <Code2 className="h-5 w-5" />
            <span>CodeLens</span>
          </div>
          <ThemeToggle />
        </div>
        
        {/* Profile */}
        <div className="p-4 border-b border-light-border dark:border-dark-border">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-sm bg-primary/20 flex items-center justify-center text-primary font-bold">
              {user?.email?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.email || 'Loading...'}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={logout}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>

        {/* History */}
        <div className="flex-1 overflow-y-auto p-2">
          <Button variant="ghost" className="w-full justify-start mb-2" onClick={startNewChat}>
            <Plus className="h-4 w-4 mr-2" />
            New Chat
          </Button>
          <div className="text-xs font-semibold text-light-muted dark:text-dark-muted uppercase tracking-wider px-2 py-2">
            History
          </div>
          <div className="space-y-1">
            {history.map(session => (
              <button 
                key={session.id}
                onClick={() => loadHistory(session.id)}
                className={`w-full text-left px-2 py-2 text-sm rounded-sm truncate transition-colors flex items-center gap-2
                  ${currentSessionId === session.id 
                    ? 'bg-primary/10 text-primary font-medium' 
                    : 'text-light-text dark:text-dark-text hover:bg-gray-100 dark:hover:bg-dark-border'}`}
              >
                <Clock className="h-3 w-3 shrink-0 opacity-50" />
                <span className="truncate">{session.title}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* CENTER: Chat Interface */}
      <main className="flex-1 flex flex-col bg-light-bg dark:bg-dark-bg min-w-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex gap-3 max-w-3xl mx-auto w-full ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              
              <div className={`w-8 h-8 rounded-sm flex items-center justify-center shrink-0 mt-1
                ${msg.role === 'assistant' ? 'bg-primary/10 text-primary' : 'bg-gray-200 dark:bg-dark-border text-gray-500 dark:text-gray-400'}`}>
                {msg.role === 'assistant' ? <Bot className="w-5 h-5" /> : <User className="w-5 h-5" />}
              </div>

              <div className={`flex-1 overflow-hidden p-4 rounded-sm border ${
                msg.role === 'user'
                  ? 'bg-light-surface dark:bg-dark-surface border-light-border dark:border-dark-border'
                  : msg.isError
                    ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-900/50'
                    : 'bg-transparent border-transparent'
              }`}>
                <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none break-words">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({node, inline, className, children, ...props}) {
                        const match = /language-(\w+)/.exec(className || '');
                        return !inline && match ? (
                          <div className="rounded-sm overflow-hidden my-4 border border-light-border dark:border-dark-border">
                            <SyntaxHighlighter
                              {...props}
                              children={String(children).replace(/\n$/, '')}
                              style={theme === 'dark' ? vscDarkPlus : vs}
                              language={match[1]}
                              PreTag="div"
                              customStyle={{ margin: 0, padding: '1rem', background: theme === 'dark' ? '#1e1e1e' : '#f5f5f5' }}
                            />
                          </div>
                        ) : (
                          <code {...props} className={`${className} bg-black/5 dark:bg-white/10 rounded-sm px-1.5 py-0.5 text-sm`}>
                            {children}
                          </code>
                        )
                      }
                    }}
                  >
                    {msg.content || (msg.isStreaming ? ' ' : '')}
                  </ReactMarkdown>
                  {msg.isStreaming && (
                    <span className="inline-block w-1.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
                  )}
                </div>

                {msg.citations && msg.citations.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-light-border dark:border-dark-border">
                    <div className="text-xs font-semibold uppercase tracking-wider text-light-muted dark:text-dark-muted mb-2 flex items-center gap-1">
                      <Code2 className="w-3 h-3" /> Sources
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {msg.citations.map((cit, cIdx) => (
                        <div key={cIdx} className="text-xs px-2 py-1 bg-light-surface dark:bg-dark-surface border border-light-border dark:border-dark-border rounded-sm text-light-muted dark:text-dark-muted">
                          {cit.file_path.split('/').pop()} <span className="opacity-50">L{cit.start_line}-{cit.end_line}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isChatLoading && (
            <div className="flex gap-3 max-w-3xl mx-auto w-full">
              <div className="w-8 h-8 rounded-sm bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-1">
                <Bot className="w-5 h-5" />
              </div>
              <div className="flex items-center gap-2 text-light-muted dark:text-dark-muted p-4">
                <span className="animate-pulse">●</span>
                <span className="animate-pulse delay-150">●</span>
                <span className="animate-pulse delay-300">●</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 border-t border-light-border dark:border-dark-border bg-light-bg dark:bg-dark-bg">
          <div className="max-w-3xl mx-auto">
            <form onSubmit={handleChatSubmit} className="relative flex items-end border border-light-border dark:border-dark-border bg-light-surface dark:bg-dark-surface rounded-sm shadow-sm focus-within:ring-1 focus-within:ring-primary focus-within:border-primary">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your codebase..."
                className="w-full max-h-40 min-h-[56px] py-4 pl-4 pr-12 bg-transparent border-none resize-none focus:outline-none text-light-text dark:text-dark-text placeholder:text-light-muted dark:placeholder:text-dark-muted"
                rows={1}
                disabled={isChatLoading}
              />
              <div className="absolute right-2 bottom-2">
                <Button type="submit" size="sm" className="h-10 w-10 p-0" disabled={!input.trim() || isChatLoading}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </form>
          </div>
        </div>
      </main>

      {/* RIGHT SIDEBAR: Ingestion & Health */}
      <aside className="w-80 border-l border-light-border dark:border-dark-border bg-light-surface dark:bg-dark-surface flex flex-col shrink-0">
        
        {/* Ingestion Panel */}
        <div className="p-4 border-b border-light-border dark:border-dark-border">
          <h3 className="font-semibold mb-1 flex items-center gap-2">
            <Database className="h-4 w-4" /> Index Repository
          </h3>
          <p className="text-xs text-light-muted dark:text-dark-muted mb-4">
            Ingest a public GitHub repository. Only Python files are indexed.
          </p>
          
          <form onSubmit={handleIngest} className="space-y-2">
            <div className="relative">
              <GitBranch className="absolute left-2.5 top-2.5 h-4 w-4 text-light-muted dark:text-dark-muted" />
              <Input
                type="url"
                placeholder="https://github.com/owner/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                className="pl-8 h-9 text-xs"
                required
                disabled={ingestStatus === 'loading'}
              />
            </div>
            <Button type="submit" className="w-full h-9 text-xs" isLoading={ingestStatus === 'loading'}>
              {ingestStatus === 'loading' ? 'Ingesting...' : 'Ingest Codebase'}
            </Button>
          </form>

          {ingestStatus === 'error' && (
            <div className="mt-3 p-2 rounded-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 flex gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
              <div className="text-xs text-red-800 dark:text-red-200 break-words">{ingestError}</div>
            </div>
          )}

          {ingestStatus === 'success' && ingestResult && (
            <div className="mt-3 p-3 rounded-sm border border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-900/10">
              <div className="flex items-center gap-1.5 text-green-700 dark:text-green-400 mb-2">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-xs font-semibold">Indexed Successfully</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-white dark:bg-dark-bg p-2 rounded-sm border border-light-border dark:border-dark-border">
                  <div className="text-lg font-bold text-primary">{ingestResult.files_processed}</div>
                  <div className="text-[10px] text-light-muted dark:text-dark-muted uppercase">Files</div>
                </div>
                <div className="bg-white dark:bg-dark-bg p-2 rounded-sm border border-light-border dark:border-dark-border">
                  <div className="text-lg font-bold text-primary">{ingestResult.chunks_processed}</div>
                  <div className="text-[10px] text-light-muted dark:text-dark-muted uppercase">Chunks</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Health Panel */}
        <div className="p-4 flex-1">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4" /> System Health
          </h3>
          
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-light-muted dark:text-dark-muted">
                <Server className="h-4 w-4" /> Backend API
              </div>
              <div className="flex items-center gap-1.5 font-medium">
                <StatusIcon status={healthData?.status} />
                {isHealthLoading ? '...' : healthData?.status || 'Offline'}
              </div>
            </div>
            
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-light-muted dark:text-dark-muted">
                <Database className="h-4 w-4" /> Qdrant DB
              </div>
              <div className="flex items-center gap-1.5 font-medium">
                <StatusIcon status={healthData?.services?.qdrant} />
                {isHealthLoading ? '...' : healthData?.services?.qdrant || 'Offline'}
              </div>
            </div>
            
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-light-muted dark:text-dark-muted">
                <Brain className="h-4 w-4" /> Ollama (Local)
              </div>
              <div className="flex items-center gap-1.5 font-medium">
                <StatusIcon status={healthData?.services?.ollama} />
                {isHealthLoading ? '...' : healthData?.services?.ollama || 'Offline'}
              </div>
            </div>
          </div>
        </div>
      </aside>

    </div>
  );
}
