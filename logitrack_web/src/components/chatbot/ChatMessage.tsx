import { Button } from '@/components/ui/button';
import type { ChatMessage } from '../../types/chatbot';

interface ChatMessageProps {
  message: ChatMessage;
  onOptionClick?: (action: string, value: string) => void;
}

export function ChatMessageComponent({ message, onOptionClick }: ChatMessageProps) {
  const isBot = message.type === 'bot';

  return (
    <div className={`flex flex-col gap-1 ${isBot ? 'self-start' : 'self-end'}`}>
      <div
        className={
          isBot
            ? 'bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-2xl rounded-tl-none p-3 max-w-[85%] text-sm text-gray-800 dark:text-gray-100 shadow-sm whitespace-pre-line'
            : 'bg-[var(--brand)] text-white rounded-2xl rounded-br-none p-3 max-w-[85%] ml-auto text-sm whitespace-pre-line'
        }
      >
        <p className="m-0 leading-relaxed">{message.text}</p>

        {message.options && message.options.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {message.options.map((option, idx) => (
              <Button
                key={idx}
                variant="outline"
                size="sm"
                className="rounded-full bg-white dark:bg-gray-700 text-xs"
                onClick={() => onOptionClick?.(option.action, option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      <span className="text-[10px] text-gray-400 dark:text-gray-500 px-1">
        {message.timestamp.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
}
