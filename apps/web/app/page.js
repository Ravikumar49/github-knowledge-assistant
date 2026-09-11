'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

export default function ChatPage() {
  const [question, setQuestion] = useState('');
  const [githubUrl, setGithubUrl] = useState('https://github.com/expressjs/express');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);

  const handleAskQuestion = async (e) => {
    e.preventDefault();
    if (!question) return;

    const currentQuestion = question;

    // Append user question to history immediately for instant feedback
    const updatedHistory = [...chatHistory, { role: 'user', content: currentQuestion }];
    setChatHistory(updatedHistory);

    setIsLoading(true);
    setAnswer('');
    setSources([]);
    setQuestion(''); // Clear the input field for next question

    try {
      const response = await fetch('http://localhost:4000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ githubUrl, messages: updatedHistory })
      });

      
      if (!response.ok) {
        throw new Error('Failed to fetch answer.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let fullAnswer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Append the final AI response to the history for the next turn
          setChatHistory((prev) => [...prev, { role: 'model', content: fullAnswer }]);
          break;
        }

        // Decode the incoming byte chunk into a string
        buffer += decoder.decode(value, { stream: true });
        
        // Split the buffer by the SSE double-newline delimiter
        const parts = buffer.split('\n\n');
        
        // Keep the last incomplete chunk in the buffer for the next loop
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (part.startsWith('data: ')) {
            const dataStr = part.replace('data: ', '');
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.type === 'sources') {
                setSources(parsed.data);
              } else if (parsed.type === 'text') {
                setAnswer((prev) => prev + parsed.data);
                fullAnswer += parsed.data; // Accumulate the full answer
              }
            } catch (err) {
              console.error('Failed to parse stream chunk', err);
            }
          }
        }
      }
    } catch (error) {
      console.error(error);
      setAnswer("Sorry, I encountered an error while querying the codebase.");
      setChatHistory(chatHistory); // Revert history on error
      setQuestion(currentQuestion);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: '850px', margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.8rem', fontWeight: '700', marginBottom: '8px' }}>GitHub Knowledge Assistant</h1>
        <p style={{ color: '#888', margin: 0 }}>Semantic code search & question answering over indexed repositories</p>
      </header>

      <form onSubmit={handleAskQuestion} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: '#aaa' }}>Target Repository</label>
          <input 
            type="text" 
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            placeholder="https://github.com/org/repo"
            style={{ 
              width: '100%', 
              padding: '10px 12px', 
              borderRadius: '6px', 
              border: '1px solid #333', 
              backgroundColor: '#161616', 
              color: '#fff',
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: '#aaa' }}>Your Question</label>
          <textarea 
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask anything about the codebase..."
            rows={4}
            style={{ 
              width: '100%', 
              padding: '10px 12px', 
              borderRadius: '6px', 
              border: '1px solid #333', 
              backgroundColor: '#161616', 
              color: '#fff',
              boxSizing: 'border-box',
              resize: 'vertical'
            }}
          />
        </div>

        <button 
          type="submit" 
          disabled={isLoading} 
          style={{ 
            padding: '12px', 
            borderRadius: '6px', 
            border: 'none', 
            backgroundColor: isLoading ? '#444' : '#2563eb', 
            color: '#fff', 
            fontWeight: '600', 
            cursor: isLoading ? 'not-allowed' : 'pointer' 
          }}
        >
          {isLoading ? 'Retrieving & Generating...' : 'Ask Assistant'}
        </button>
      </form>

      {answer && (
        <article style={{ marginTop: '32px', padding: '24px', border: '1px solid #2a2a2a', borderRadius: '8px', backgroundColor: '#111' }}>
          <h2 style={{ fontSize: '1.25rem', marginTop: 0, marginBottom: '16px', borderBottom: '1px solid #2a2a2a', paddingBottom: '8px' }}>
            Answer
          </h2>

          <div style={{ lineHeight: '1.7', fontSize: '0.95rem', color: '#e5e5e5' }}>
            <ReactMarkdown
              components={{
                code: ({ node, ...props }) => (
                  <code style={{ backgroundColor: '#262626', color: '#f1f5f9', border: '1px solid #383838', padding: '2px 6px', borderRadius: '4px', fontSize: '0.88em', fontFamily: 'monospace' }} {...props} />
                ),
                pre: ({ node, ...props }) => (
                  <pre style={{ backgroundColor: '#1a1a1a', padding: '16px', borderRadius: '6px', overflowX: 'auto', border: '1px solid #333' }} {...props} />
                ),
                ul: ({ node, ...props }) => <ul style={{ paddingLeft: '24px', margin: '12px 0' }} {...props} />,
                ol: ({ node, ...props }) => <ol style={{ paddingLeft: '24px', margin: '12px 0' }} {...props} />,
                li: ({ node, ...props }) => <li style={{ marginBottom: '6px' }} {...props} />
              }}
            >
              {answer}
            </ReactMarkdown>
          </div>
              {sources.length > 0 && (
                <footer style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #222' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Retrieved Context Files
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
                    {sources.map((source, index) => {
                  // 1. Normalize Windows backslashes to forward slashes for the URL
                  const normalizedPath = source.replace(/\\/g, '/');
                  
                  // 2. Construct the GitHub link to the file
                  const githubLink = `${githubUrl}/blob/main/${normalizedPath}`;

                  return (
                    <a 
                      key={index} 
                      href={githubLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ 
                        display: 'inline-block',
                        marginRight: '8px',
                        marginBottom: '8px',
                        padding: '4px 12px',
                        backgroundColor: '#1e293b', // Matches your dark theme
                        color: '#60a5fa', // Blue link color
                        borderRadius: '9999px',
                        fontSize: '0.85rem',
                        textDecoration: 'none',
                      }}
                      onMouseOver={(e) => e.currentTarget.style.textDecoration = 'underline'}
                      onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
                    >
                      {source}
                    </a>
                  );
                })}
              </div>
            </footer>
          )}
        </article>
      )}
    </main>
  );
}