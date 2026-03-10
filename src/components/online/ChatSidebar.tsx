import { useState, useEffect, useRef } from 'react';
import { sendChatMessage, sendEmote, getSocket } from '../../lib/multiplayerSocket';
import type { ChatMessage } from '../../lib/multiplayerSocket';
import './ChatSidebar.css';

const EMOTES = ['👍','👎','😂','😱','🤔','💀','🔥','🙏'];

interface Props {
  myName: string;
  opponentName: string;
  isOpen: boolean;
  onToggle: () => void;
  unreadCount: number;
  onRead: () => void;
}

export function ChatSidebar({ myName, opponentName, isOpen, onToggle, unreadCount, onRead }: Props) {
  const [messages, setMessages] = useState<(ChatMessage & { isSelf?: boolean })[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const socket = getSocket();

    socket.on('chat_message', (msg: ChatMessage) => {
      setMessages(prev => [...prev, { ...msg, isSelf: false }]);
    });

    socket.on('chat_message_echo', (msg: ChatMessage) => {
      setMessages(prev => [...prev, { ...msg, isSelf: true }]);
    });

    return () => {
      socket.off('chat_message');
      socket.off('chat_message_echo');
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      onRead();
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages.length]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    sendChatMessage(text);
    setInput('');
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {/* Toggle button */}
      <button className={`chat-toggle-btn ${isOpen ? 'open' : ''}`} onClick={onToggle} title="Chat">
        💬
        {unreadCount > 0 && !isOpen && (
          <span className="chat-badge">{unreadCount}</span>
        )}
      </button>

      {/* Sidebar */}
      <div className={`chat-sidebar ${isOpen ? 'open' : ''}`}>
        <div className="chat-header">
          <span>💬 Chat</span>
          <button className="chat-close-btn" onClick={onToggle}>✕</button>
        </div>

        <div className="chat-messages">
          {messages.length === 0 && (
            <p className="chat-empty">Sem mensagens ainda. Diga olá! 👋</p>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`chat-msg ${msg.isSelf ? 'self' : 'opponent'}`}>
              {msg.emote ? (
                <span className="chat-emote">{msg.emote}</span>
              ) : (
                <>
                  <span className="chat-msg-name">{msg.isSelf ? myName : opponentName}</span>
                  <span className="chat-msg-text">{msg.text}</span>
                </>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="chat-emotes">
          {EMOTES.map(e => (
            <button key={e} className="chat-emote-btn" onClick={() => sendEmote(e)} title={e}>
              {e}
            </button>
          ))}
        </div>

        <div className="chat-input-row">
          <input
            className="chat-input"
            type="text"
            placeholder="Mensagem..."
            value={input}
            onChange={ev => setInput(ev.target.value)}
            onKeyDown={handleKey}
            maxLength={200}
          />
          <button className="btn btn-gold chat-send-btn" onClick={handleSend}>➤</button>
        </div>
      </div>
    </>
  );
}
