import React, { useRef, useState } from 'react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  showFileUpload?: boolean;
  onFileSelect?: (file: File) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  disabled = false,
  placeholder = 'Escribe tu mensaje...',
  showFileUpload = false,
  onFileSelect,
}) => {
  const [input, setInput] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

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
    // Reset para permitir seleccionar el mismo archivo dos veces
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <form className="chat-input" onSubmit={handleSubmit}>
      {showFileUpload && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <button
            type="button"
            className="chat-attach-btn"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
            title="Adjuntar archivo"
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
