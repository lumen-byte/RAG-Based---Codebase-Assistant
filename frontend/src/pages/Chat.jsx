import { useState, useRef, useEffect, useContext } from 'react';
import { api } from '../services/api';
import { AuthContext } from '../context/AuthContext';
import ReactMarkdown from 'react-markdown';

export default function Chat() {
  const { user, logout } = useContext(AuthContext);

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

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle Ingestion
  const handleIngest = async (e) => {
    e.preventDefault();
    if (!repoUrl) return;
    setIsIngesting(true);
    setIngestStatus('Ingesting...');
    try {
      await api.ingestRepo(repoUrl);
      setIngestStatus('Success!');
      setTimeout(() => setIngestStatus(''), 3000);
      setRepoUrl('');
    } catch {
      setIngestStatus('Error!');
      setTimeout(() => setIngestStatus(''), 3000);
    } finally {
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
        updated = prev.map(h => h.id === currentSessionId ? { ...h, messages: newMessages } : h);
      } else {
        const title = newMessages.find(m => m.role === 'user')?.content.substring(0, 30) + '...';
        updated = [{ id: currentSessionId, title: title || 'New Chat', messages: newMessages }, ...prev];
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

  const loadHistory = (sessionId) => {
    const session = history.find(h => h.id === sessionId);
    if (session) {
      setMessages(session.messages);
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
    setMessages(newMessages);
    saveToHistory(newMessages);
    setIsChatLoading(true);

    const assistantMsgId = Date.now();
    setMessages([...newMessages, { role: 'assistant', content: '', id: assistantMsgId, isStreaming: true }]);

    await api.askQuestionStream(
      userMessage,
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
        <div className="w-64 border-r border-black dark:border-gray-800 bg-white dark:bg-black flex flex-col h-full absolute md:relative z-10 transition-colors duration-200">
          <div className="p-4 border-b border-black dark:border-gray-800 flex justify-between items-center bg-black dark:bg-white text-white dark:text-black">
            <span className="font-bold">History</span>
            <button onClick={() => setShowHistory(false)} className="text-white dark:text-black hover:opacity-75">✕</button>
          </div>
          <div className="p-2 border-b border-black dark:border-gray-800">
            <button onClick={startNewChat} className="w-full text-left p-2 border border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black transition-colors">
              + New Chat
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {history.map(session => (
              <button
                key={session.id}
                onClick={() => loadHistory(session.id)}
                className={`w-full text-left p-2 text-sm truncate border transition-colors ${currentSessionId === session.id ? 'border-black dark:border-white bg-black dark:bg-white text-white dark:text-black' : 'border-transparent hover:border-black dark:hover:border-white'}`}
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
                {isIngesting ? 'Ingesting...' : 'Ingest'}
              </button>

              {/* Ingestion Status Indicators */}
              {isIngesting && (
                <svg className="animate-spin h-4 w-4 text-black dark:text-white ml-2 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {!isIngesting && ingestStatus === 'Success!' && (
                <svg className="h-5 w-5 text-green-500 ml-2 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {!isIngesting && ingestStatus === 'Error!' && (
                <svg className="h-5 w-5 text-red-500 ml-2 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
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
            <span className="font-bold hidden sm:inline">{user?.email}</span>
            <button onClick={logout} className="border border-black dark:border-white px-3 py-1 hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black transition-colors">
              Sign Out
            </button>
          </div>
        </header>

        {/* Center: Chat Interface */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-3xl mx-auto space-y-8">
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
                  <div className={`max-w-[85%] px-4 py-3 border ${msg.role === 'user' ? 'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900' : 'border-black dark:border-gray-600 bg-white dark:bg-black'}`}>
                    <div className="prose prose-sm prose-black dark:prose-invert max-w-none break-words leading-relaxed">
                      <ReactMarkdown>
                        {msg.content || (msg.isStreaming ? '...' : '')}
                      </ReactMarkdown>
                    </div>
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-black/10 dark:border-white/20">
                        <div className="text-[10px] font-bold uppercase tracking-wider mb-2 text-gray-500 dark:text-gray-400">Sources</div>
                        <div className="flex flex-wrap gap-2">
                          {msg.citations.map((cit, cIdx) => (
                            <div key={cIdx} className="text-xs border border-gray-200 dark:border-gray-700 px-2 py-1 bg-gray-50 dark:bg-gray-900 truncate max-w-xs">
                              {cit.file_path.split('/').pop()} (L{cit.start_line}-{cit.end_line})
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
