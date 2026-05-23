import React from 'react';
import type { ChatMessage } from '../../types/chatbot';

interface ChatMessageProps {
  message: ChatMessage;
  onOptionClick?: (action: string, value: string) => void;
}

export const ChatMessageComponent: React.FC<ChatMessageProps> = ({ 
  message, 
  onOptionClick 
}) => {
  return (
    <div className={`chat-message ${message.type}`}>
      <div className="message-bubble">
        <p>{message.text}</p>
        
        {message.options && message.options.length > 0 && (
          <div className="message-options">
            {message.options.map((option, idx) => (
              <button
                key={idx}
                className="option-button"
                onClick={() => onOptionClick?.(option.action, option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="message-time">
        {message.timestamp.toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
    </div>
  );
};