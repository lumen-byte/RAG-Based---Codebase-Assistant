import { useState, useRef, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useUser, useClerk } from '@clerk/clerk-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

export default function Chat() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const navigate = useNavigate();

  // Repo  Ingestion
  const [repoUrl, setRepoUrl] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestStatus, setIngestStatus] = useState('');

  // Chat
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // History Toggle
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState(() => {
    const saved = localStorage.getItem('minimal_chat_history');
    return saved ? JSON.parse(saved) : [];
  });
  const [currentSessionId, setCurrentSessionId] = useState(() => Date.now().toString());

  const [ingestionProgress, setIngestionProgress] = useState(0);
  const [activeRepoUrl, setActiveRepoUrl] = useState('');

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

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle Ingestion
  const handleIngest = async (e) => {
    e.preventDefault();
    if (!repoUrl) return;
    
    // Automatically start a new chat if there are existing messages
    if (messages.length > 0) {
      startNewChat();
    }
    
    setActiveRepoUrl(repoUrl);
    setIsIngesting(true);
    setIngestionProgress(0);
    setIngestStatus('Ingesting... 0%');
    try {
      await api.ingestRepo(repoUrl);
      
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await api.checkIngestionStatus(repoUrl);
          setIngestionProgress(statusRes.progress);
          
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

    } catch (err) {
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
  const saveToHistory = (newMessages) => {
    if (newMessages.length === 0) return;
    setHistory(prev => {
      const existing = prev.find(h => h.id === currentSessionId);
      let updated;
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
    // Note: We don't reset activeRepoUrl here so the user can continue querying the same repo in a fresh thread if they want.
  };

  const loadHistory = (sessionId) => {
    const session = history.find(h => h.id === sessionId);
    if (session) {
      setMessages(session.messages);
      setActiveRepoUrl(session.repoUrl || '');
      setCurrentSessionId(sessionId);
      setShowHistory(false);
    }
  };

  // Handle Chat Submit
  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isChatLoading) return;

    const userMessage = input.trim();
    setInput('');

    const newMessages = [...messages, { role: 'user', content: userMessage }];
    
    if (ingestionProgress === 0 && ingestStatus !== 'Success!') {
      setMessages([...newMessages, { role: 'assistant', content: 'The file is not ingested yet. Please ingest a repository first.', isError: true }]);
      return;
    }

    setMessages(newMessages);
    saveToHistory(newMessages);
    setIsChatLoading(true);

    const assistantMsgId = Date.now();
    setMessages([...newMessages, { role: 'assistant', content: '', id: assistantMsgId, isStreaming: true }]);

    await api.askQuestionStream(
      userMessage,
      activeRepoUrl,
      ingestionProgress < 100 ? ingestionProgress : null,
      (token) => {
        setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: m.content + token } : m));
      },
      (citations) => {
        setMessages(prev => {
          const updated = prev.map(m => m.id === assistantMsgId ? { ...m, citations, isStreaming: false } : m);
          saveToHistory(updated);
          return updated;
        });
        setIsChatLoading(false);
      },
      (errorMsg) => {
        setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: `Error: ${errorMsg}`, isError: true, isStreaming: false } : m));
        setIsChatLoading(false);
      }
    );
  };

  return (
    <div className="flex h-screen bg-white dark:bg-black text-black dark:text-white font-sans transition-colors duration-200">

      {/* Left Sidebar (Optional History Overlay or fixed) */}
      {showHistory && (
        <div className="w-64 border-r border-gray-800 bg-black text-white flex flex-col h-full absolute md:relative z-10">
          <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-black text-white">
            <span className="font-bold">History</span>
            <button onClick={() => setShowHistory(false)} className="text-white hover:opacity-75">✕</button>
          </div>
          <div className="p-2 border-b border-gray-800">
            <button onClick={startNewChat} className="w-full text-left p-2 border border-gray-600 hover:bg-white hover:text-black transition-colors">
              + New Chat
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {history.map(session => (
              <button
                key={session.id}
                onClick={() => loadHistory(session.id)}
                className={`w-full text-left p-2 text-sm truncate border transition-colors ${currentSessionId === session.id ? 'border-white bg-white text-black' : 'border-transparent hover:border-gray-600'}`}
              >
                {session.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">

        {/* Top Navigation Bar */}
        <header className="h-16 border-b border-black dark:border-gray-800 flex items-center justify-between px-4 shrink-0 transition-colors duration-200">
          {/* Left Corner: Repo Ingestion */}
          <div className="flex items-center gap-2">
            {!showHistory && (
              <button onClick={() => setShowHistory(true)} className="md:hidden border border-black dark:border-white px-2 py-1 mr-2 text-sm hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black transition-colors">
                ☰
              </button>
            )}
            <form onSubmit={handleIngest} className="flex items-center">
              <input
                type="text"
                placeholder="Repository URL"
                className="border border-black dark:border-gray-600 bg-transparent px-3 py-1 text-sm focus:outline-none focus:border-black dark:focus:border-white w-48 lg:w-64 transition-colors"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                disabled={isIngesting}
              />
              <button
                type="submit"
                className="border border-black dark:border-gray-600 border-l-0 px-3 py-1 text-sm bg-white dark:bg-black hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black transition-colors disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:text-gray-500"
                disabled={isIngesting || !repoUrl}
              >
                {isIngesting ? ingestStatus : 'Ingest'}
              </button>

              {/* Ingestion Status Indicators */}
              {isIngesting && (
                <svg className="animate-spin h-4 w-4 text-black dark:text-white ml-2 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {!isIngesting && ingestStatus === 'Success!' && (
                <div className="flex items-center ml-2 text-green-500 font-bold" title="Repository successfully ingested">
                  <svg className="h-6 w-6 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="ml-1 text-sm hidden sm:inline">Ingested</span>
                </div>
              )}
              {!isIngesting && ingestStatus.startsWith('Error') && (
                <div className="flex items-center ml-2 text-red-500 text-xs">
                  <svg className="h-5 w-5 shrink-0 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  {ingestStatus}
                </div>
              )}
            </form>
          </div>

          {/* Right Corner: History Toggle & Profile */}
          <div className="flex items-center gap-4 text-sm">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="hidden md:block underline hover:no-underline"
            >
              History
            </button>
            <span className="font-bold hidden sm:inline">{user?.primaryEmailAddress?.emailAddress}</span>
            <button onClick={() => signOut()} className="border border-black dark:border-white px-3 py-1 hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black transition-colors">
              Sign Out
            </button>
          </div>
        </header>

        {/* Center: Chat Interface */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-3xl mx-auto space-y-8">
            
            {/* Dynamic Repository Heading */}
            {activeRepoUrl && (
              <div className="text-center mb-6 border-b border-black dark:border-gray-800 pb-4 mt-2">
                <h2 className="text-xl md:text-2xl font-extrabold uppercase tracking-widest text-black dark:text-white">
                  {getRepoHeading()}
                </h2>
                <a href={activeRepoUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline mt-1 inline-block">
                  {activeRepoUrl}
                </a>
              </div>
            )}

            {messages.length === 0 ? (
              <div className="text-center text-gray-500 dark:text-gray-400 mt-20">
                <h2 className="text-2xl font-bold text-black dark:text-white mb-2">How can I help you?</h2>
                <p>Ingest a repository above and start asking questions.</p>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`text-xs font-bold mb-1 ${msg.role === 'user' ? 'text-gray-500 dark:text-gray-400' : 'text-black dark:text-white'}`}>
                    {msg.role === 'user' ? 'YOU' : 'AI'}
                  </div>
                  <div className={`w-full max-w-[95%] md:max-w-[85%] px-5 py-4 rounded-xl border ${msg.role === 'user' ? 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#111111]' : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0a0a0a] shadow-sm'}`}>
                    <div className="prose prose-sm max-w-none break-words leading-relaxed text-black dark:text-gray-100">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code({node, inline, className, children, ...props}) {
                            const match = /language-(\w+)/.exec(className || '')
                            return !inline && match ? (
                              <SyntaxHighlighter
                                {...props}
                                children={String(children).replace(/\n$/, '')}
                                style={vscDarkPlus}
                                language={match[1]}
                                PreTag="div"
                                className="rounded-lg border border-gray-800 my-4 text-[13px] font-mono overflow-hidden !bg-[#1e1e1e]"
                              />
                            ) : (
                              <code {...props} className="bg-gray-100 dark:bg-gray-800/80 text-pink-600 dark:text-pink-400 px-1.5 py-0.5 rounded-md text-xs font-mono border border-gray-200 dark:border-gray-700">
                                {children}
                              </code>
                            )
                          },
                          h1: ({node, ...props}) => <h1 className="text-2xl font-bold mt-6 mb-4 pb-2 border-b border-gray-200 dark:border-gray-800 text-black dark:text-white" {...props} />,
                          h2: ({node, ...props}) => <h2 className="text-xl font-bold mt-5 mb-3 text-black dark:text-white" {...props} />,
                          h3: ({node, ...props}) => <h3 className="text-lg font-bold mt-4 mb-2 text-black dark:text-white" {...props} />,
                          p: ({node, ...props}) => <p className="mb-4 leading-relaxed" {...props} />,
                          ul: ({node, ...props}) => <ul className="list-disc pl-6 mb-4 space-y-1 marker:text-gray-400" {...props} />,
                          ol: ({node, ...props}) => <ol className="list-decimal pl-6 mb-4 space-y-1 marker:text-gray-400" {...props} />,
                          li: ({node, ...props}) => <li className="leading-relaxed" {...props} />,
                          a: ({node, ...props}) => <a className="text-blue-600 dark:text-blue-400 hover:underline decoration-blue-400/30 underline-offset-2" target="_blank" rel="noreferrer" {...props} />,
                          table: ({node, ...props}) => (
                            <div className="overflow-x-auto my-4 border border-gray-200 dark:border-gray-800 rounded-lg">
                              <table className="min-w-full text-sm divide-y divide-gray-200 dark:divide-gray-800" {...props} />
                            </div>
                          ),
                          th: ({node, ...props}) => <th className="bg-gray-50 dark:bg-[#111111] px-4 py-2 font-semibold text-left border-b border-gray-200 dark:border-gray-800 text-black dark:text-gray-200" {...props} />,
                          td: ({node, ...props}) => <td className="px-4 py-2 border-t border-gray-200 dark:border-gray-800" {...props} />,
                          blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-gray-300 dark:border-gray-700 pl-4 py-1 italic text-gray-600 dark:text-gray-400 my-4 bg-gray-50 dark:bg-[#111111] rounded-r-lg" {...props} />
                        }}
                      >
                        {msg.content || (msg.isStreaming ? '...' : '')}
                      </ReactMarkdown>
                    </div>
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="mt-5 pt-4 border-t border-gray-200 dark:border-gray-800">
                        <div className="text-[11px] font-semibold tracking-widest text-gray-500 mb-3 flex items-center gap-2">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          SOURCES
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {msg.citations.map((cit, cIdx) => (
                            <div key={cIdx} className="flex items-center gap-3 p-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#111111] hover:border-blue-500 dark:hover:border-blue-500 transition-colors cursor-pointer group shadow-sm">
                              <div className="bg-white dark:bg-black border border-gray-200 dark:border-gray-800 p-1.5 rounded-md group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 transition-colors">
                                <svg className="w-4 h-4 text-gray-500 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                              </div>
                              <div className="overflow-hidden">
                                <div className="text-[13px] font-semibold text-black dark:text-gray-200 truncate">{cit.file_path.split('/').pop()}</div>
                                <div className="text-[11px] font-mono text-gray-500 truncate mt-0.5">{cit.file_path} (L{cit.start_line}-{cit.end_line})</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {isChatLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex flex-col items-start">
                <div className="text-xs font-bold mb-1 text-black dark:text-white">AI</div>
                <div className="max-w-[85%] px-4 py-3 border border-black dark:border-gray-600 bg-white dark:bg-black text-gray-400">
                  Thinking...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Bottom: Chat Input */}
        <div className="p-4 md:p-8 pt-0 border-t border-black dark:border-gray-800 bg-white dark:bg-black transition-colors duration-200">
          <div className="max-w-3xl mx-auto mt-4">
            <form onSubmit={handleChatSubmit} className="relative flex">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything..."
                disabled={isChatLoading}
                className="w-full border border-black dark:border-gray-600 border-r-0 py-3 pl-4 pr-12 focus:outline-none bg-transparent"
              />
              <button
                type="submit"
                disabled={!input.trim() || isChatLoading}
                className="border border-black dark:border-gray-600 px-6 py-3 font-bold hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black transition-colors disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-400 dark:disabled:text-gray-500 disabled:hover:bg-gray-100 dark:disabled:hover:bg-gray-800 disabled:hover:text-gray-400 dark:disabled:hover:text-gray-500"
              >
                Send
              </button>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
}
