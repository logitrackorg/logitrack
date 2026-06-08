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
  const isBot = message.type === 'bot';


  return (
    <div className={`flex flex-col gap-1 ${isBot ? 'self-start' : 'self-end'}`}>
      <div
        className={
          isBot
            ? 'bg-white border border-gray-200 rounded-2xl rounded-tl-none p-3 max-w-[85%] text-sm text-gray-800 shadow-sm whitespace-pre-line'
            : 'bg-[var(--brand)] text-white rounded-2xl rounded-br-none p-3 max-w-[85%] ml-auto text-sm whitespace-pre-line'
        }
      >
        <p className="m-0 leading-relaxed">{message.text}</p>
        
        {message.options && message.options.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {message.options.map((option, idx) => (
              <button
                key={idx}
                className="px-3 py-1.5 rounded-full bg-white border border-gray-200 text-xs text-gray-700 hover:bg-gray-50 hover:border-gray-300 cursor-pointer transition-colors text-left"
                onClick={() => onOptionClick?.(option.action, option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="text-[10px] text-gray-400 mt-1">
        {message.timestamp.toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
    </div>
  );
};
