import React, { useRef, useState } from 'react';
import { Paperclip, ArrowRight } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  fileUploadDisabled?: boolean;
  placeholder?: string;
  showFileUpload?: boolean;
  onFileSelect?: (file: File) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  disabled = false,
  fileUploadDisabled,
  placeholder = 'Escribe tu mensaje...',
  showFileUpload = false,
  onFileSelect,
}) => {
  const [input, setInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachDisabled = fileUploadDisabled ?? disabled;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput('');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onFileSelect) {
      onFileSelect(file);
    }
    e.target.value = '';
  };

  return (
    <form className="border-t border-gray-200 p-3 flex items-center gap-2" onSubmit={handleSubmit}>
      {showFileUpload && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx"
            className="hidden"
            onChange={handleFileChange}
            disabled={attachDisabled}
          />
          <button
            type="button"
            className="bg-gray-100 border-none rounded-full w-8 h-8 flex items-center justify-center cursor-pointer hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={attachDisabled}
            title="Adjuntar archivo"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip size={16} />
          </button>
        </>
      )}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 border border-gray-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/20 focus:border-[var(--brand)] disabled:bg-gray-50 disabled:cursor-not-allowed"
      />
      <button
        type="submit"
        disabled={disabled || !input.trim()}
        className="bg-[var(--brand)] text-white border-none rounded-full w-8 h-8 flex items-center justify-center cursor-pointer hover:shadow-md transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <ArrowRight size={16} />
      </button>
    </form>
  );
};
