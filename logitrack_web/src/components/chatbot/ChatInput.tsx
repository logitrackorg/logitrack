import React, { useRef, useState } from 'react';

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
    <form className="chat-input" onSubmit={handleSubmit}>
      {showFileUpload && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx"
            style={{ display: 'none' }}
            onChange={handleFileChange}
            disabled={attachDisabled}
          />
          <button
            type="button"
            className="attach-btn"
            disabled={attachDisabled}
            title="Adjuntar archivo"
            onClick={() => fileInputRef.current?.click()}
          >
            📎
          </button>
        </>
      )}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      <button type="submit" disabled={disabled || !input.trim()}>
        Enviar
      </button>
    </form>
  );
};
