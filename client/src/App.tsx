import { useEffect, useRef, useState } from "react";

type Message = {
  id: number;
  text: string;
  isUser: boolean;
};

const starterPrompts = [
  "Can we talk about this video? https://www.youtube.com/watch?v=kEtGm75uBes",
  "What is this tutorial mainly about?",
  "Summarize the key ideas from the video in simple words.",
];

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<string>(String(Date.now()));
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const sendMessage = async (text = inputText) => {
    const trimmedText = text.trim();

    if (!trimmedText || isLoading) {
      return;
    }

    const userMessage: Message = {
      id: Date.now(),
      text: trimmedText,
      isUser: true,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText("");
    setIsLoading(true);

    try {
      const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";

      const response = await fetch(`${apiUrl}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: userMessage.text,
          thread_id: threadId,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get a response from the server.");
      }

      const data = await response.text();

      const aiMessage: Message = {
        id: Date.now() + 1,
        text: data || "I did not receive any response text.",
        isUser: false,
      };

      setMessages((prev) => [...prev, aiMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: Date.now() + 1,
        text:
          error instanceof Error
            ? `Sorry, something went wrong: ${error.message}`
            : "Sorry, something went wrong while processing your request.",
        isUser: false,
      };

      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const resetChat = () => {
    setMessages([]);
    setThreadId(String(Date.now()));
    setInputText("");
  };

  return (
    <div className="app-shell">
      <div className="app-frame">
        <header className="hero">
          <div>
            <p className="eyebrow">Full-Stack RAG Chat</p>
            <h1>AI Chat With YouTube</h1>
            <p className="hero-copy">
              Paste a YouTube link into your message and ask questions about the
              video. The agent will index it with Bright Data and answer using
              transcript retrieval.
            </p>
          </div>
          <button className="secondary-button" onClick={resetChat}>
            New Chat
          </button>
        </header>

        <section className="prompt-strip">
          {starterPrompts.map((prompt) => (
            <button
              key={prompt}
              className="prompt-chip"
              onClick={() => setInputText(prompt)}
            >
              {prompt}
            </button>
          ))}
        </section>

        <main className="chat-panel">
          <div className="messages-container">
            {messages.length === 0 ? (
              <div className="empty-state">
                <h2>Start with a YouTube link</h2>
                <p>
                  Example: <br />
                  <span>
                    Can we talk about this video?
                    https://www.youtube.com/watch?v=kEtGm75uBes
                  </span>
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  key={message.id}
                  className={`message-row ${
                    message.isUser ? "user-row" : "assistant-row"
                  }`}
                >
                  <div className="message-badge">
                    {message.isUser ? "You" : "AI"}
                  </div>
                  <div className="message-card">
                    <p>{message.text}</p>
                  </div>
                </article>
              ))
            )}

            {isLoading && (
              <article className="message-row assistant-row">
                <div className="message-badge">AI</div>
                <div className="message-card loading-card">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </div>
              </article>
            )}

            <div ref={messagesEndRef} />
          </div>

          <footer className="composer">
            <textarea
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Paste a YouTube URL and ask your question..."
              disabled={isLoading}
              rows={3}
            />

            <div className="composer-actions">
              <p>Press Enter to send, Shift+Enter for a new line.</p>
              <button
                className="primary-button"
                onClick={() => void sendMessage()}
                disabled={!inputText.trim() || isLoading}
              >
                Send
              </button>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

export default App;
