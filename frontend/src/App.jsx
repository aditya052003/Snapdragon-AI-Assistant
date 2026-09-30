import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./App.css";

const API_URL = "http://127.0.0.1:8000";
const STORAGE_KEY = "snapdragon-chat-history";

const INITIAL_MESSAGE = {
  role: "assistant",
  content:
    "Hello! I'm Snapdragon AI Assistant. How can I help you today?",
};

function App() {
  const [activeTab, setActiveTab] = useState("chat");
  const [chatSearch, setChatSearch] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const recognitionRef = useRef(null);

  // Load multiple saved conversations (and migrate the previous single chat)
  const [conversations, setConversations] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0 &&
            parsed[0]?.id && Array.isArray(parsed[0]?.messages)) {
          return parsed;
        }
        // Migrate the older format, which stored only an array of messages.
        if (Array.isArray(parsed) && parsed.length > 0) {
          return [{
            id: `chat-${Date.now()}`,
            title: getChatTitle(parsed),
            messages: parsed,
            updatedAt: Date.now(),
          }];
        }
      }
    } catch (error) {
      console.error("Failed to load saved conversations:", error);
    }
    return [{
      id: `chat-${Date.now()}`,
      title: "New chat",
      messages: [INITIAL_MESSAGE],
      updatedAt: Date.now(),
    }];
  });

  const [activeChatId, setActiveChatId] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (Array.isArray(saved) && saved[0]?.id &&
          Array.isArray(saved[0]?.messages)) return saved[0].id;
    } catch {}
    return null;
  });

  const activeConversation =
    conversations.find((chat) => chat.id === activeChatId) || conversations[0];
  const messages = activeConversation?.messages || [INITIAL_MESSAGE];

  useEffect(() => {
    if (!activeChatId && conversations[0]) setActiveChatId(conversations[0].id);
    else if (activeChatId && !conversations.some((chat) => chat.id === activeChatId) && conversations[0]) {
      setActiveChatId(conversations[0].id);
    }
  }, [activeChatId, conversations]);

  function getChatTitle(chatMessages) {
    const firstUserMessage = chatMessages?.find((message) => message.role === "user");
    return firstUserMessage?.content?.trim().slice(0, 32) || "New chat";
  }

  // Chat states
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // PDF states
  const [pdfFile, setPdfFile] = useState(null);
  const [summary, setSummary] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);

  // Code Assistant states
  const [codeInput, setCodeInput] = useState("");
  const [codeOutput, setCodeOutput] = useState("");
  const [codeLoading, setCodeLoading] = useState(false);

  // Shared error state
  const [error, setError] = useState("");

  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // Scroll to the latest message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, chatLoading]);

  // Persist all conversations in this browser
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    } catch (error) {
      console.error("Failed to save conversations:", error);
      setError("Unable to save chats in this browser.");
    }
  }, [conversations]);

  // AI Chat with conversation history
  const handleSend = async (e) => {
    e.preventDefault();

    const userMessage = chatInput.trim();

    if (!userMessage || chatLoading) return;

    setError("");
    setChatInput("");
    setChatLoading(true);

    // Keep previous conversation for the backend
    const history = messages
      .filter(
        (message) =>
          message.role === "user" ||
          message.role === "assistant"
      )
      .slice(-10)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    // Display the user's message immediately
    setConversations((previous) =>
      previous.map((chat) =>
        chat.id === activeConversation.id
          ? {
              ...chat,
              title: getChatTitle([...chat.messages, { role: "user", content: userMessage }]),
              messages: [...chat.messages, { role: "user", content: userMessage }],
              updatedAt: Date.now(),
            }
          : chat
      )
    );

    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userMessage,
          history,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "Failed to get AI response."
        );
      }

      setConversations((previous) =>
        previous.map((chat) =>
          chat.id === activeConversation.id
            ? {
                ...chat,
                messages: [...chat.messages, {
                  role: "assistant",
                  content: data.reply || "No response received.",
                }],
                updatedAt: Date.now(),
              }
            : chat
        )
      );
    } catch (err) {
      setError(
        err.message ||
          "Unable to connect to the AI server."
      );

      setConversations((previous) =>
        previous.map((chat) =>
          chat.id === activeConversation.id
            ? {
                ...chat,
                messages: [...chat.messages, {
                  role: "assistant",
                  content:
                    "Sorry, I couldn't process your message. Please check that the backend and Ollama are running.",
                }],
                updatedAt: Date.now(),
              }
            : chat
        )
      );
    } finally {
      setChatLoading(false);
    }
  };

  // Start a new conversation without deleting previous chats
  const clearChat = () => {
    if (chatLoading) return;

    const newChat = {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: "New chat",
      messages: [INITIAL_MESSAGE],
      updatedAt: Date.now(),
    };

    setConversations((previous) => [newChat, ...previous]);
    setActiveChatId(newChat.id);
    setChatInput("");
    setError("");
  };

  // Open a previously saved conversation
  const openChat = (chatId) => {
    if (chatLoading) return;
    setActiveChatId(chatId);
    setChatInput("");
    setError("");
    setActiveTab("chat");
  };

  // Delete one saved conversation
  const deleteChat = (chatId) => {
    if (chatLoading) return;
    setConversations((previous) => {
      const remaining = previous.filter((chat) => chat.id !== chatId);
      if (chatId === activeConversation.id) {
        const nextChat = remaining[0] || {
          id: `chat-${Date.now()}`,
          title: "New chat",
          messages: [INITIAL_MESSAGE],
          updatedAt: Date.now(),
        };
        if (remaining.length === 0) remaining.push(nextChat);
        setActiveChatId(nextChat.id);
      }
      return remaining;
    });
  };

  // Select PDF file
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];

    setSummary("");
    setError("");

    if (!file) {
      setPdfFile(null);
      return;
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setPdfFile(null);
      setError("Please select a PDF file.");
      e.target.value = "";
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setPdfFile(null);
      setError("File size must be less than 10 MB.");
      e.target.value = "";
      return;
    }

    setPdfFile(file);
  };

  // PDF Summarizer
  const handleSummarize = async () => {
    if (!pdfFile || pdfLoading) {
      if (!pdfFile) {
        setError("Please upload a PDF file first.");
      }
      return;
    }

    setError("");
    setSummary("");
    setPdfLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", pdfFile);

      const response = await fetch(
        `${API_URL}/api/summarize`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "Failed to summarize PDF."
        );
      }

      setSummary(
        data.summary || "No summary was generated."
      );
    } catch (err) {
      setError(
        err.message || "Unable to summarize the PDF."
      );
    } finally {
      setPdfLoading(false);
    }
  };

  // Remove selected PDF
  const removePdf = () => {
    setPdfFile(null);
    setSummary("");
    setError("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Code Assistant
  const handleCodeSubmit = async (e) => {
    e.preventDefault();

    const question = codeInput.trim();

    if (!question || codeLoading) return;

    setError("");
    setCodeOutput("");
    setCodeLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: question,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            "Failed to get coding assistance."
        );
      }

      setCodeOutput(
        data.reply || "No response received."
      );
    } catch (err) {
      setError(
        err.message ||
          "Unable to connect to the AI server."
      );
    } finally {
      setCodeLoading(false);
    }
  };

  // Export the active conversation as a text file
  const exportChat = () => {
    const chatText = messages
      .map((message) => {
        const role = message.role === "user" ? "You" : "Snapdragon AI";
        return `${role}:\n${message.content}`;
      })
      .join("\n\n");

    const blob = new Blob([chatText], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeTitle = (activeConversation?.title || "chat")
      .replace(/[\\/:*?"<>|]/g, "-")
      .trim();

    link.href = url;
    link.download = `${safeTitle || "chat"}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Voice input using the browser's Web Speech API
  const toggleVoiceInput = () => {
    if (voiceListening) {
      recognitionRef.current?.stop();
      setVoiceListening(false);
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("Voice input is not supported in this browser. Try Google Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.continuous = true;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setVoiceListening(true);
      setError("");
    };

    recognition.onresult = (event) => {
      // With interimResults disabled, each result is a completed phrase.
      // Only append newly reported final results to avoid repeating live captions.
      const transcript = Array.from(event.results)
        .slice(event.resultIndex)
        .filter((result) => result.isFinal)
        .map((result) => result[0].transcript.trim())
        .filter(Boolean)
        .join(" ");

      if (transcript) {
        setChatInput((previous) => {
          const separator = previous.trim() ? " " : "";
          return `${previous}${separator}${transcript}`;
        });
      }
    };

    recognition.onerror = (event) => {
      setVoiceListening(false);
      if (event.error !== "no-speech" && event.error !== "aborted") {
        setError(`Voice input error: ${event.error}. Please check microphone permissions.`);
      }
    };

    recognition.onend = () => {
      setVoiceListening(false);
    };

    try {
      recognition.start();
    } catch (err) {
      setVoiceListening(false);
      setError("Unable to start voice input. Please try again.");
    }
  };

  // Copy text to clipboard
  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError(
        "Unable to copy text. Please copy it manually."
      );
    }
  };

  const filteredConversations = conversations.filter((chat) => {
    const query = chatSearch.trim().toLowerCase();
    if (!query) return true;
    return (
      (chat.title || "").toLowerCase().includes(query) ||
      (chat.messages || []).some((message) =>
        (message.content || "").toLowerCase().includes(query)
      )
    );
  });

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">✦</div>
          <div>
            <h2>Snapdragon AI</h2>
            <span>ASSISTANT</span>
          </div>
        </div>

        <div className="sidebar-label">WORKSPACE</div>

        <nav className="navigation">
          <button
            className={`nav-item ${
              activeTab === "chat" ? "active" : ""
            }`}
            onClick={() => {
              setActiveTab("chat");
              setError("");
            }}
          >
            <span className="nav-icon">✧</span>
            <span>AI Chat</span>
          </button>

          <button
            className={`nav-item ${
              activeTab === "pdf" ? "active" : ""
            }`}
            onClick={() => {
              setActiveTab("pdf");
              setError("");
            }}
          >
            <span className="nav-icon">▤</span>
            <span>PDF Summarizer</span>
          </button>

          <button
            className={`nav-item ${
              activeTab === "code" ? "active" : ""
            }`}
            onClick={() => {
              setActiveTab("code");
              setError("");
            }}
          >
            <span className="nav-icon">{"</>"}</span>
            <span>Code Assistant</span>
          </button>
        </nav>

        <div className="saved-chats">
          <div className="saved-chats-heading">YOUR CHATS</div>
          <input
            className="chat-search-input"
            type="search"
            value={chatSearch}
            onChange={(e) => setChatSearch(e.target.value)}
            placeholder="Search chats..."
            aria-label="Search saved chats"
          />
          <div className="saved-chat-list">
            {filteredConversations.length > 0 ? (
              filteredConversations.map((chat) => (
              <div
                className={`saved-chat-item ${chat.id === activeConversation.id ? "selected" : ""}`}
                key={chat.id}
              >
                <button
                  className="saved-chat-open"
                  onClick={() => openChat(chat.id)}
                  title={chat.title}
                  disabled={chatLoading}
                >
                  <span className="saved-chat-icon">▤</span>
                  <span className="saved-chat-title">{chat.title}</span>
                </button>
                <button
                  className="saved-chat-delete"
                  onClick={() => deleteChat(chat.id)}
                  aria-label={`Delete ${chat.title}`}
                  title="Delete chat"
                  disabled={chatLoading}
                >
                  ×
                </button>
              </div>
              ))
            ) : (
              <p className="no-chats-found">No matching chats</p>
            )}
          </div>
        </div>

        <div className="sidebar-bottom">
          <div className="status-card">
            <span className="status-dot"></span>
            <div>
              <strong>Local AI</strong>
              <p>Powered by Ollama</p>
            </div>
          </div>

          <p className="sidebar-footer">
            Snapdragon AI Assistant v1.0
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="topbar-label">
              YOUR PERSONAL AI
            </span>

            <h1>
              {activeTab === "chat" && "AI Chat"}
              {activeTab === "pdf" && "PDF Summarizer"}
              {activeTab === "code" && "Code Assistant"}
            </h1>
          </div>

          <div className="topbar-status">
            <span className="status-dot"></span>
            Local model
          </div>
        </header>

        {/* Error message */}
        {error && (
          <div className="error-message" role="alert">
            <span>⚠</span>
            <span>{error}</span>
            <button
              onClick={() => setError("")}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        {/* AI Chat */}
        {activeTab === "chat" && (
          <section className="chat-section">
            <div className="chat-toolbar">
              <div>
                <strong>Conversation</strong>
                <p>
                  Ask anything and get AI-powered answers.
                </p>
              </div>

              <div className="chat-toolbar-actions">
                <button
                  className="secondary-button"
                  onClick={exportChat}
                  disabled={chatLoading || messages.length <= 1}
                >
                  ↓ Export chat
                </button>
                <button
                  className="secondary-button"
                  onClick={clearChat}
                  disabled={chatLoading}
                >
                  ↻ New chat
                </button>
              </div>
            </div>

            <div className="chat-messages">
              {messages.map((message, index) => (
                <div
                  className={`message-row ${message.role}`}
                  key={`${index}-${message.role}`}
                >
                  <div className="message-avatar">
                    {message.role === "assistant"
                      ? "✦"
                      : "You"}
                  </div>

                  <div className="message-content">
                    <div className="message-name">
                      {message.role === "assistant"
                        ? "Snapdragon AI"
                        : "You"}
                    </div>

                    <div className="message-bubble markdown-content">
                      {message.role === "assistant" ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                      ) : (
                        message.content
                      )}
                    </div>

                    {message.role === "assistant" &&
                      index !== 0 && (
                        <button
                          className="copy-button"
                          onClick={() =>
                            copyToClipboard(message.content)
                          }
                        >
                          Copy response
                        </button>
                      )}
                  </div>
                </div>
              ))}

              {chatLoading && (
                <div className="message-row assistant">
                  <div className="message-avatar">✦</div>

                  <div className="message-content">
                    <div className="message-name">
                      Snapdragon AI
                    </div>

                    <div className="message-bubble loading-bubble">
                      <span className="typing-dot"></span>
                      <span className="typing-dot"></span>
                      <span className="typing-dot"></span>
                      <span className="loading-text">
                        Thinking...
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef}></div>
            </div>

            <form
              className="chat-input-area"
              onSubmit={handleSend}
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) =>
                  setChatInput(e.target.value)
                }
                placeholder="Message Snapdragon AI..."
                disabled={chatLoading}
              />

              <button
                type="button"
                className="secondary-button"
                onClick={toggleVoiceInput}
                disabled={chatLoading}
                title={voiceListening ? "Stop voice input" : "Start voice input"}
                aria-label={voiceListening ? "Stop voice input" : "Start voice input"}
                style={{ padding: "0 12px", minWidth: "44px" }}
              >
                {voiceListening ? "■" : "🎤"}
              </button>

              <button
                type="submit"
                className="send-button"
                disabled={
                  !chatInput.trim() || chatLoading
                }
              >
                {chatLoading ? "..." : "↑"}
              </button>
            </form>

            <p className="input-disclaimer">
              AI responses may contain errors. Verify
              important information.
            </p>
          </section>
        )}

        {/* PDF Summarizer */}
        {activeTab === "pdf" && (
          <section className="tool-section">
            <div className="tool-heading">
              <div className="tool-icon">▤</div>

              <h2>Summarize your documents</h2>

              <p>
                Upload a PDF and let AI extract the key
                points and important information.
              </p>
            </div>

            <div className="upload-card">
              <div
                className="upload-area"
                onClick={() =>
                  fileInputRef.current?.click()
                }
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" ||
                    e.key === " "
                  ) {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
              >
                <div className="upload-icon">↑</div>

                <h3>Upload your PDF</h3>

                <p>
                  Click to browse and select a PDF document
                </p>

                <span className="upload-limit">
                  PDF files up to 10 MB
                </span>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleFileChange}
                  hidden
                />
              </div>

              {pdfFile && (
                <div className="file-info">
                  <div className="file-icon">PDF</div>

                  <div className="file-details">
                    <strong>{pdfFile.name}</strong>
                    <span>
                      {(
                        pdfFile.size /
                        (1024 * 1024)
                      ).toFixed(2)}{" "}
                      MB
                    </span>
                  </div>

                  <button
                    className="remove-file"
                    onClick={removePdf}
                    aria-label="Remove PDF"
                  >
                    ×
                  </button>
                </div>
              )}

              <button
                className="primary-button"
                onClick={handleSummarize}
                disabled={!pdfFile || pdfLoading}
              >
                {pdfLoading
                  ? "Summarizing..."
                  : "✦ Generate Summary"}
              </button>
            </div>

            {pdfLoading && (
              <div className="loading-card">
                <div className="spinner"></div>
                <p>
                  Reading your document and generating
                  a summary...
                </p>
              </div>
            )}

            {summary && (
              <div className="result-card">
                <div className="result-header">
                  <div>
                    <span className="result-label">
                      AI GENERATED
                    </span>
                    <h3>Document Summary</h3>
                  </div>

                  <button
                    className="secondary-button"
                    onClick={() =>
                      copyToClipboard(summary)
                    }
                  >
                    Copy summary
                  </button>
                </div>

                <div className="result-text markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {summary}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Code Assistant */}
        {activeTab === "code" && (
          <section className="tool-section">
            <div className="tool-heading">
              <div className="tool-icon">{"</>"}</div>

              <h2>Your personal coding assistant</h2>

              <p>
                Ask programming questions, debug errors,
                or request code explanations.
              </p>
            </div>

            <form
              className="code-card"
              onSubmit={handleCodeSubmit}
            >
              <label htmlFor="code-question">
                Your coding question
              </label>

              <textarea
                id="code-question"
                value={codeInput}
                onChange={(e) =>
                  setCodeInput(e.target.value)
                }
                placeholder={`Example:
Explain the difference between an array and an ArrayList in Java.

Or paste your code and ask me to find the error...`}
                rows={8}
                disabled={codeLoading}
              />

              <div className="code-actions">
                <span>
                  Powered by your local AI model
                </span>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={
                    !codeInput.trim() || codeLoading
                  }
                >
                  {codeLoading
                    ? "Generating..."
                    : "✦ Get Answer"}
                </button>
              </div>
            </form>

            {codeLoading && (
              <div className="loading-card">
                <div className="spinner"></div>
                <p>Analyzing your question...</p>
              </div>
            )}

            {codeOutput && (
              <div className="result-card">
                <div className="result-header">
                  <div>
                    <span className="result-label">
                      AI RESPONSE
                    </span>
                    <h3>Code Assistant Answer</h3>
                  </div>

                  <button
                    className="secondary-button"
                    onClick={() =>
                      copyToClipboard(codeOutput)
                    }
                  >
                    Copy answer
                  </button>
                </div>

                <div className="result-text markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {codeOutput}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default App;