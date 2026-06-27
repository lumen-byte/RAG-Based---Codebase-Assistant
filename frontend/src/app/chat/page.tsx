'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, setTokenFetcher, Citation } from '@/services/api';
import { useSession, signOut } from 'next-auth/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface Message {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  isError?: boolean;
  citations?: Citation[];
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  repoUrl: string;
}

export default function Chat() {
  const { data: session, status } = useSession({
    required: true,
    onUnauthenticated() {
      router.push('/sign-in');
    },
  });
  const router = useRouter();

  useEffect(() => {
    if (session && (session as any).backendToken) {
      setTokenFetcher(() => (session as any).backendToken);
    }
  }, [session]);

  // Repo Ingestion
  const [repoUrl, setRepoUrl] = useState<string>('');
  const [isIngesting, setIsIngesting] = useState<boolean>(false);
  const [ingestStatus, setIngestStatus] = useState<string>('');
  const [ingestStage, setIngestStage] = useState<string>('');
  const [ingestSteps, setIngestSteps] = useState<string[]>([]);

  // Chat
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const justSentRef = useRef(false);

  // History Toggle
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [history, setHistory] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');

  // Profile Dropdown
  const [showProfile, setShowProfile] = useState<boolean>(false);

  // Need to use useEffect for localStorage so it doesn't mismatch on server render
  useEffect(() => {
    const saved = localStorage.getItem('minimal_chat_history');
    if (saved) {
      setHistory(JSON.parse(saved));
    }
    setCurrentSessionId(Date.now().toString());
  }, []);

  const [ingestionProgress, setIngestionProgress] = useState<number>(0);
  const [activeRepoUrl, setActiveRepoUrl] = useState<string>('');

  // Detect manual scroll-up to disable auto-follow
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let lastScrollTop = container.scrollTop;

    const handleScroll = () => {
      // If user scrolled UP by more than 80px, disable auto-follow
      if (container.scrollTop < lastScrollTop - 80) {
        shouldAutoScrollRef.current = false;
      }
      // Re-enable if user scrolls back near bottom
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distFromBottom < 100) {
        shouldAutoScrollRef.current = true;
      }
      lastScrollTop = container.scrollTop;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // ChatGPT-style scroll: only position query on send, never scroll during generation
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Only scroll once when user sends a message — position query at upper-middle
    if (justSentRef.current) {
      justSentRef.current = false;
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = requestAnimationFrame(() => {
        const target = Math.max(0, container.scrollHeight - container.clientHeight * 0.80);
        container.scrollTo({ top: target, behavior: 'smooth' });
        scrollRafRef.current = null;
      });
    }
    // During streaming: do absolutely nothing — let the user control the scroll
  }, [messages]);
  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  if (status === "loading") {
    return <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#0a0a0a] text-black dark:text-white">
      <div className="animate-pulse flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-t-blue-500 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin"></div>
        <p className="text-sm text-gray-500 tracking-widest uppercase">Loading Workspace</p>
      </div>
    </div>;
  }

  // Derive a clean heading from activeRepoUrl
  const getRepoHeading = () => {
    if (!activeRepoUrl) return '';
    try {
      const parts = activeRepoUrl.split('/');
      const repoName = parts[parts.length - 1] || parts[parts.length - 2];
      return repoName.replace(/[-_]/g, ' ');
    } catch {
      return 'Repository';
    }
  };

  // Handle Ingestion
  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;

    if (messages.length > 0) {
      startNewChat();
    }

    setActiveRepoUrl(repoUrl);
    setIsIngesting(true);
    setIngestionProgress(0);
    setIngestStatus('Ingesting... 0%');
    setIngestStage('Initializing');
    setIngestSteps([]);
    try {
      await api.ingestRepo(repoUrl);

      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await api.checkIngestionStatus(repoUrl);
          setIngestionProgress(statusRes.progress);
          if (statusRes.stage) setIngestStage(statusRes.stage);
          if (statusRes.step_details) setIngestSteps(statusRes.step_details);

          if (statusRes.status === 'completed') {
            clearInterval(pollInterval);
            setIsIngesting(false);
            setIngestStatus('Success!');
          } else if (statusRes.status === 'failed') {
            clearInterval(pollInterval);
            setIsIngesting(false);
            setIngestStatus(`Error: ${statusRes.error || 'Ingestion failed'}`);
            setTimeout(() => setIngestStatus(''), 5000);
          } else if (statusRes.status === 'not_found') {
            clearInterval(pollInterval);
            setIsIngesting(false);
            setIngestStatus('Error: Task lost (backend restarted)');
            setTimeout(() => setIngestStatus(''), 5000);
          } else {
            setIngestStatus(`Ingesting... ${statusRes.progress}%`);
          }
        } catch (pollErr) {
          console.error("Polling error", pollErr);
        }
      }, 1500);

    } catch (err: any) {
      if (err.response?.status === 401) {
        setIngestStatus('Error: Unauthorized');
      } else {
        const errorDetail = err.response?.data?.detail || err.message;
        setIngestStatus(`Error: ${errorDetail}`);
      }
      setTimeout(() => setIngestStatus(''), 5000);
      setIsIngesting(false);
    }
  };

  // Handle History
  const saveToHistory = (newMessages: Message[]) => {
    if (newMessages.length === 0) return;
    setHistory(prev => {
      const existing = prev.find(h => h.id === currentSessionId);
      let updated: ChatSession[];
      if (existing) {
        updated = prev.map(h => h.id === currentSessionId ? { ...h, messages: newMessages, repoUrl: activeRepoUrl } : h);
      } else {
        const title = newMessages.find(m => m.role === 'user')?.content.substring(0, 30) + '...';
        updated = [{ id: currentSessionId, title: title || 'New Chat', messages: newMessages, repoUrl: activeRepoUrl }, ...prev];
      }
      localStorage.setItem('minimal_chat_history', JSON.stringify(updated));
      return updated;
    });
  };

  const startNewChat = () => {
    setMessages([]);
    setCurrentSessionId(Date.now().toString());
    setShowHistory(false);
  };

  const handleCancelIngestion = async () => {
    try {
      setIngestStatus('Cancelling...');
      await api.cancelIngestion(repoUrl);
    } catch (err) {
      console.error("Failed to cancel ingestion", err);
      setIngestStatus('Cancel failed');
      setTimeout(() => {
        if (isIngesting) setIngestStatus('Ingesting...');
      }, 3000);
    }
  };

  const handleReset = () => {
    setRepoUrl('');
    setActiveRepoUrl('');
    setIngestionProgress(0);
    setIngestStatus('');
    setIsIngesting(false);
    startNewChat();
  };

  const loadHistory = (sessionId: string) => {
    const session_obj = history.find(h => h.id === sessionId);
    if (session_obj) {
      setMessages(session_obj.messages);
      setActiveRepoUrl(session_obj.repoUrl || '');
      setCurrentSessionId(sessionId);
      setShowHistory(false);

      // Also update the input field for ingestion to match the loaded history
      setRepoUrl(session_obj.repoUrl || '');
      setIngestStatus('Success!');
      setIngestionProgress(100);
    }
  };

  // Handle Chat Submit
  const handleChatSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isChatLoading) return;

    const userMessage = input.trim();
    setInput('');

    // Reset textarea height manually after clearing input
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const newMessages: Message[] = [...messages, { role: 'user', content: userMessage }];

    if (ingestionProgress === 0 && ingestStatus !== 'Success!') {
      setMessages([...newMessages, { role: 'assistant', content: 'The file is not ingested yet. Please ingest a repository first.', isError: true }]);
      return;
    }

    setMessages(newMessages);
    saveToHistory(newMessages);
    setIsChatLoading(true);
    justSentRef.current = true;
    shouldAutoScrollRef.current = true;

    const assistantMsgId = Date.now();
    let assistantMessageAdded = false;

    await api.askQuestionStream(
      userMessage,
      activeRepoUrl,
      ingestionProgress < 100 ? ingestionProgress : null,
      (token: string) => {
        if (!assistantMessageAdded) {
          assistantMessageAdded = true;
          setMessages(prev => [...prev, { role: 'assistant', content: token, id: assistantMsgId, isStreaming: true }]);
        } else {
          setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: m.content + token } : m));
        }
      },
      (citations: Citation[]) => {
        setMessages(prev => {
          let updated = prev;
          if (!assistantMessageAdded) {
            updated = [...prev, { role: 'assistant', content: '', id: assistantMsgId, citations, isStreaming: false }];
          } else {
            updated = prev.map(m => m.id === assistantMsgId ? { ...m, citations, isStreaming: false } : m);
          }
          saveToHistory(updated);
          return updated;
        });
        setIsChatLoading(false);
      },
      (errorMsg: string) => {
        setMessages(prev => {
          if (!assistantMessageAdded) {
            return [...prev, { role: 'assistant', content: `Error: ${errorMsg}`, id: assistantMsgId, isError: true, isStreaming: false }];
          }
          return prev.map(m => m.id === assistantMsgId ? { ...m, content: `Error: ${errorMsg}`, isError: true, isStreaming: false } : m);
        });
        setIsChatLoading(false);
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit();
    }
  };

  const renderProgressBar = (progress: number) => {
    const filled = Math.floor(progress / 10);
    const empty = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  };

  return (
    <div className="flex h-screen bg-white dark:bg-[#0a0a0a] text-black dark:text-white font-sans transition-colors duration-300">

      {/* Glassmorphic History Sidebar */}
      {showHistory && (
        <div className="w-72 border-r border-gray-200 dark:border-gray-800/60 bg-white/90 dark:bg-[#0f0f0f]/90 backdrop-blur-xl text-black dark:text-white flex flex-col h-full absolute md:relative z-20 shadow-2xl transition-all duration-300 ease-in-out">
          <div className="p-5 border-b border-gray-200 dark:border-gray-800/60 flex justify-between items-center">
            <span className="font-semibold tracking-wide text-sm flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Chat History
            </span>
            <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-black dark:hover:text-white transition-colors p-1 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-3">
            <button onClick={startNewChat} className="w-full text-left p-3 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all font-medium text-sm flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Chat
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 pt-0 space-y-1">
            {history.map(session_item => (
              <button
                key={session_item.id}
                onClick={() => loadHistory(session_item.id)}
                className={`w-full text-left p-3 text-sm truncate rounded-xl transition-all border group relative overflow-hidden ${currentSessionId === session_item.id ? 'border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 shadow-sm' : 'border-transparent text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/50'}`}
              >
                {currentSessionId === session_item.id && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 dark:bg-blue-400 rounded-l-xl"></div>
                )}
                {session_item.title}
              </button>
            ))}
            {history.length === 0 && (
              <div className="text-center text-gray-400 dark:text-gray-600 text-sm mt-10">
                No history yet
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative bg-gray-50 dark:bg-[#0a0a0a]">

        {/* Top Navigation Bar */}
        <header className="h-[72px] border-b border-gray-200 dark:border-gray-800/60 bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur-md flex items-center justify-between px-4 md:px-6 shrink-0 transition-colors duration-300 z-10 sticky top-0">
          {/* Left Corner: History Toggle & Repo Ingestion */}
          <div className="flex items-center gap-3 w-full max-w-2xl">
            {!showHistory && (
              <button
                onClick={() => setShowHistory(true)}
                className="text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white transition-colors p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800"
                title="Toggle History"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
              </button>
            )}
            <form onSubmit={handleIngest} className="flex flex-1 items-center bg-gray-100 dark:bg-[#111111] rounded-xl border border-gray-200 dark:border-gray-800/60 overflow-hidden focus-within:ring-2 focus-within:ring-blue-500/30 focus-within:border-blue-500/50 transition-all duration-200">
              <div className="pl-4 text-gray-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="Paste GitHub Repository URL"
                className="bg-transparent px-3 py-2.5 text-sm focus:outline-none w-full text-black dark:text-white placeholder-gray-500 font-medium rounded-xl"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                disabled={isIngesting}
              />
              <button
                type="submit"
                className="px-5 py-2.5 text-sm font-semibold text-white bg-black dark:bg-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors disabled:bg-gray-300 dark:disabled:bg-gray-800 disabled:text-gray-500 rounded-r-xl"
                disabled={isIngesting || !repoUrl}
              >
                {isIngesting ? 'Ingesting' : 'Connect'}
              </button>
            </form>

            {/* Cancel/Reset Buttons next to the form */}
            {isIngesting && (
              <button
                type="button"
                onClick={handleCancelIngestion}
                className="p-2.5 rounded-xl text-red-500 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                title="Stop ingestion"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}

            {activeRepoUrl && !isIngesting && ingestStatus === 'Success!' && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-green-50 border border-green-200 dark:bg-green-900/10 dark:border-green-900/30 text-green-600 dark:text-green-400 text-xs font-bold tracking-wide">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                CONNECTED
              </div>
            )}
            {activeRepoUrl && !isIngesting && (
              <button
                type="button"
                onClick={handleReset}
                className="p-2.5 rounded-xl text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                title="Disconnect repository"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}

            {/* Error Indicator */}
            {!isIngesting && ingestStatus.startsWith('Error') && (
              <div className="flex items-center text-red-500 text-xs font-medium px-3">
                {ingestStatus}
              </div>
            )}
          </div>

          {/* Right Corner: Custom User Dropdown */}
          <div className="flex items-center ml-4 relative">
            <button
              onClick={() => setShowProfile(!showProfile)}
              className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-emerald-400 hover:shadow-lg hover:shadow-emerald-500/20 transition-all flex items-center justify-center text-white font-bold text-lg ring-2 ring-transparent hover:ring-white dark:hover:ring-gray-700"
            >
              {session?.user?.email?.charAt(0).toUpperCase() || 'U'}
            </button>

            {showProfile && (
              <div className="absolute right-0 top-14 mt-2 w-56 bg-white dark:bg-[#111111] border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl z-50 overflow-hidden transform transition-all">
                <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#0f0f0f]">
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-semibold mb-1">Account</p>
                  <p className="text-sm font-bold text-black dark:text-white truncate" title={session?.user?.email || ''}>
                    {session?.user?.email}
                  </p>
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: '/sign-in' })}
                  className="w-full text-left px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors flex items-center gap-2 rounded-b-xl"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Center: Chat Interface */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 md:px-6 md:py-8 pb-64 md:pb-40">
          <div className="max-w-3xl mx-auto space-y-8 pb-4">

            {/* Ingestion Progress Card */}
            {isIngesting && (
              <div className="w-full bg-white dark:bg-[#151515] border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm p-6 mt-4 font-mono text-sm">
                <div className="text-gray-900 dark:text-gray-100 font-bold mb-1">
                  {ingestStage || 'Initializing...'}
                </div>
                <div className="text-blue-600 dark:text-blue-400 mb-6 font-bold tracking-widest text-lg">
                  {renderProgressBar(ingestionProgress)} {ingestionProgress}%
                </div>

                {ingestSteps.length > 0 && (
                  <div className="space-y-2 text-gray-600 dark:text-gray-300">
                    {ingestSteps.map((step, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-green-500 font-bold">✓</span>
                        {step.replace('✓ ', '')}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Dynamic Repository Heading */}
            {activeRepoUrl && (
              <div className="text-center mt-6 mb-10">
                <h2 className="text-2xl md:text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-gray-900 to-gray-500 dark:from-white dark:to-gray-400">
                  {getRepoHeading()}
                </h2>
                <a href={activeRepoUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-500 hover:text-blue-600 dark:hover:text-blue-400 hover:underline decoration-blue-500/30 underline-offset-4 mt-2 inline-flex items-center gap-1 transition-colors">
                  View Repository
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            )}

            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center mt-24 md:mt-32 px-4">

                <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 mb-3">
                  How can I help you today?
                </h2>

                {ingestStatus === 'Success!' || ingestionProgress === 100 ? (
                  <div className="flex flex-col items-center gap-3 mt-2">
                    <div className="flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
                      <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                        {getRepoHeading() || 'Repository'} connected
                      </span>
                    </div>
                    <p className="text-gray-500 dark:text-gray-400 max-w-md text-base">
                      Your codebase is ready — ask anything about the architecture, functions, or logic.
                    </p>
                  </div>
                ) : (
                  <p className="text-gray-500 dark:text-gray-400 max-w-md text-lg">
                    Connect a GitHub repository above and start exploring your codebase with AI.
                  </p>
                )}
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div key={idx} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`flex w-full ${msg.role === 'user' ? 'max-w-[85%] md:max-w-[75%] justify-end' : 'max-w-full flex-col'} gap-3 items-start`}>

                    {msg.role === 'user' ? (
                      <div className="px-5 py-3.5 bg-gray-100 dark:bg-[#202020] text-black dark:text-white rounded-2xl rounded-tr-sm shadow-sm inline-block max-w-fit">
                        <div className="whitespace-pre-wrap leading-relaxed text-[15px]">{msg.content}</div>
                      </div>
                    ) : (
                      <div className="flex w-full gap-4 md:gap-6">
                        {/* Assistant Avatar */}
                        <div className="w-8 h-8 rounded-full bg-black dark:bg-white flex items-center justify-center shrink-0 mt-1 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
                          <svg className="w-4 h-4 text-white dark:text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                        </div>

                        {/* Assistant Content (Flush Left, No Bubble) */}
                        <div className="flex flex-col w-full min-w-0 pt-1.5 pb-4">
                          <div className="w-full min-w-0 text-[15px] leading-[1.8] text-gray-800 dark:text-gray-200">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                // Every paragraph gets large bottom margin — immune to AI formatting
                                p: ({ children }: any) => (
                                  <p className="mb-6 leading-[1.85] text-[15px] text-gray-800 dark:text-gray-200">
                                    {children}
                                  </p>
                                ),
                                // H1
                                h1: ({ children }: any) => (
                                  <h1 className="text-[22px] font-bold text-black dark:text-white mt-8 mb-4 tracking-tight leading-snug">
                                    {children}
                                  </h1>
                                ),
                                // H2
                                h2: ({ children }: any) => (
                                  <h2 className="text-[19px] font-bold text-black dark:text-white mt-8 mb-4 tracking-tight leading-snug">
                                    {children}
                                  </h2>
                                ),
                                // H3
                                h3: ({ children }: any) => (
                                  <h3 className="text-[17px] font-semibold text-black dark:text-white mt-6 mb-3 tracking-tight leading-snug">
                                    {children}
                                  </h3>
                                ),
                                // Ordered list — each item gets explicit spacing
                                ol: ({ children }: any) => (
                                  <ol className="list-none space-y-0 my-6 pl-0">
                                    {children}
                                  </ol>
                                ),
                                // Unordered list
                                ul: ({ children }: any) => (
                                  <ul className="list-none space-y-0 my-6 pl-0">
                                    {children}
                                  </ul>
                                ),
                                // CRITICAL: Every list item gets huge bottom spacing
                                li: ({ children, node, ordered, index, ...props }: any) => {
                                  const isOrdered = ordered || (node && node.parent && node.parent.tagName === 'ol');
                                  const itemNumber = index !== undefined ? index + 1 : (props as any)['data-index'];

                                  return (
                                    <li className="flex gap-4 mb-6 items-start leading-[1.85] text-[15px] text-gray-800 dark:text-gray-200">
                                      {isOrdered ? (
                                        <span className="text-blue-600 dark:text-blue-400 font-mono font-semibold text-[14px] mt-[1px] min-w-[24px] shrink-0 select-none">
                                          {itemNumber}.
                                        </span>
                                      ) : (
                                        <div className="mt-[8px] shrink-0 flex items-center justify-center">
                                          <svg className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 drop-shadow-[0_0_6px_rgba(59,130,246,0.6)]" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z" />
                                          </svg>
                                        </div>
                                      )}
                                      <span className="flex-1 min-w-0">{children}</span>
                                    </li>
                                  );
                                },
                                // Bold: extrabold with true black/white
                                strong: ({ children }: any) => (
                                  <strong className="font-extrabold text-black dark:text-white">
                                    {children}
                                  </strong>
                                ),
                                // Inline code
                                code(props: any) {
                                  const { inline, className, children, ...rest } = props;
                                  const match = /language-(\w+)/.exec(className || '')
                                  const lang = match ? match[1] : '';
                                  return !inline && match ? (
                                    <div className="my-6 rounded-xl overflow-hidden border border-gray-200/80 dark:border-gray-800 shadow-sm bg-[#1e1e1e]">
                                      <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-gray-800/60">
                                        <span className="text-xs font-mono text-gray-400 lowercase">{lang}</span>
                                        <div className="flex gap-1.5">
                                          <div className="w-2.5 h-2.5 rounded-full bg-red-400/40"></div>
                                          <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/40"></div>
                                          <div className="w-2.5 h-2.5 rounded-full bg-green-400/40"></div>
                                        </div>
                                      </div>
                                      <SyntaxHighlighter
                                        {...rest}
                                        children={String(children).replace(/\n$/, '')}
                                        style={vscDarkPlus as any}
                                        language={lang}
                                        PreTag="div"
                                        customStyle={{ margin: 0, padding: '1rem', background: 'transparent' }}
                                        className="text-[13px] font-mono !bg-transparent"
                                      />
                                    </div>
                                  ) : (
                                    <code {...rest} className="bg-gray-100 dark:bg-white/[0.08] text-pink-600 dark:text-pink-400 px-1.5 py-0.5 rounded-md text-[13px] font-mono border border-gray-200 dark:border-white/5">
                                      {children}
                                    </code>
                                  )
                                },
                                // HR separator
                                hr: () => (
                                  <hr className="my-8 border-gray-200 dark:border-gray-800/60" />
                                ),
                                // Links
                                a: ({ children, href }: any) => (
                                  <a href={href} className="text-blue-600 dark:text-blue-400 hover:underline underline-offset-2 transition-colors" target="_blank" rel="noreferrer">
                                    {children}
                                  </a>
                                ),
                                // Blockquote
                                blockquote: ({ children }: any) => (
                                  <blockquote className="border-l-4 border-gray-300 dark:border-gray-700 pl-4 my-6 text-gray-600 dark:text-gray-400 italic">
                                    {children}
                                  </blockquote>
                                ),
                              }}
                            >
                              {msg.content || (msg.isStreaming ? '●' : '')}
                            </ReactMarkdown>
                          </div>

                          {/* Citations block */}
                          {msg.citations && msg.citations.length > 0 && (
                            <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-800/60">
                              <div className="text-[11px] font-bold tracking-widest text-gray-400 mb-4 flex items-center gap-2 uppercase">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Sources Retrieved
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {msg.citations.map((cit, cIdx) => (
                                  <div key={cIdx} className="flex items-center gap-3 p-3 rounded-xl border border-gray-200/80 dark:border-gray-800/80 bg-white dark:bg-[#151515] hover:border-blue-300 dark:hover:border-blue-500/50 hover:shadow-md hover:shadow-blue-500/5 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group">
                                    <div className="bg-gray-50 dark:bg-[#202020] border border-gray-200/80 dark:border-gray-800 p-2.5 rounded-lg group-hover:bg-blue-50 dark:group-hover:bg-blue-500/10 group-hover:border-blue-200 dark:group-hover:border-blue-500/30 transition-colors">
                                      <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                      </svg>
                                    </div>
                                    <div className="overflow-hidden">
                                      <div className="text-[13px] font-semibold text-gray-900 dark:text-gray-200 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{cit.file_path.split('/').pop()}</div>
                                      <div className="text-[11px] font-mono text-gray-500 truncate mt-0.5">{cit.file_path} (L{cit.start_line}-{cit.end_line})</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {/* Premium Loading Skeleton Indicator */}
            {isChatLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex w-full justify-start mt-6">
                <div className="flex w-full max-w-full gap-4 md:gap-6 items-start">
                  <div className="w-8 h-8 rounded-full bg-black dark:bg-white flex items-center justify-center shrink-0 mt-1 shadow-sm ring-1 ring-black/5 dark:ring-white/10 opacity-70">
                    <svg className="w-4 h-4 text-white dark:text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div className="flex flex-col gap-3 w-full max-w-2xl pt-2">
                    <div className="h-4 bg-gray-200 dark:bg-gray-800/80 rounded-md w-full animate-pulse"></div>
                    <div className="h-4 bg-gray-200 dark:bg-gray-800/80 rounded-md w-5/6 animate-pulse" style={{ animationDelay: '150ms' }}></div>
                    <div className="h-4 bg-gray-200 dark:bg-gray-800/80 rounded-md w-4/6 animate-pulse" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} className="h-4" />
          </div>
        </div>

        {/* Bottom: Chat Input Area */}
        <div className="p-4 pt-16 pb-6 bg-gradient-to-t from-gray-50 via-gray-50/95 to-transparent dark:from-[#0a0a0a] dark:via-[#0a0a0a]/95 dark:to-transparent absolute bottom-0 w-full z-10 pointer-events-none transition-colors duration-300">
          <div className="max-w-3xl mx-auto relative pointer-events-auto">
            <form onSubmit={handleChatSubmit} className="relative flex items-end shadow-xl shadow-black/5 dark:shadow-black/20 rounded-2xl bg-white dark:bg-[#151515] border border-gray-200/80 dark:border-gray-800 focus-within:ring-1 focus-within:ring-gray-300 dark:focus-within:ring-gray-600 transition-all duration-200 group">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about the codebase... (Shift + Enter for new line)"
                disabled={isChatLoading}
                className="w-full max-h-60 py-4 pl-5 pr-14 focus:outline-none bg-transparent resize-none text-black dark:text-white placeholder-gray-400 leading-relaxed min-h-[56px] rounded-2xl"
                rows={1}
              />
              <div className="absolute right-2 bottom-2 flex items-center justify-center">
                <button
                  type="submit"
                  disabled={!input.trim() || isChatLoading}
                  className="w-10 h-10 flex items-center justify-center rounded-xl font-bold bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200 transition-all duration-200 transform hover:scale-[1.02] active:scale-95 disabled:opacity-30 disabled:hover:bg-black dark:disabled:hover:bg-white disabled:cursor-not-allowed disabled:transform-none"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                  </svg>
                </button>
              </div>
            </form>
            <div className="text-center mt-3 text-[11px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">
              AI Codebase Assistant can make mistakes. Verify important code.
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
