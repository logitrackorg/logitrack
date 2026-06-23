import { useRef, useState } from 'react';
import { Paperclip, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CLAIM_EVIDENCE_ACCEPT } from '@/utils/claimDecisionTree';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  fileUploadDisabled?: boolean;
  placeholder?: string;
  showFileUpload?: boolean;
  onFileSelect?: (file: File) => void;
}

export function ChatInput({
  onSend,
  disabled = false,
  fileUploadDisabled,
  placeholder = 'Escribe tu mensaje...',
  showFileUpload = false,
  onFileSelect,
}: ChatInputProps) {
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
    if (file && onFileSelect) onFileSelect(file);
    e.target.value = '';
  };

  return (
    <form className="border-t border-gray-200 dark:border-gray-700 p-3 flex items-center gap-2" onSubmit={handleSubmit}>
      {showFileUpload && (
        <>
          <input ref={fileInputRef} type="file" accept={CLAIM_EVIDENCE_ACCEPT} className="hidden" onChange={handleFileChange} disabled={attachDisabled} />
          <Button type="button" variant="ghost" size="icon" disabled={attachDisabled} title="Adjuntar archivo" onClick={() => fileInputRef.current?.click()} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <Paperclip size={16} />
          </Button>
        </>
      )}
      <input
        type="text" value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder} disabled={disabled}
        className="flex-1 border border-gray-200 dark:border-gray-600 rounded-full px-4 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/20 focus:border-[var(--brand)] disabled:bg-gray-50 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-all"
      />
      <Button type="submit" size="icon" disabled={disabled || !input.trim()} className="rounded-full shrink-0">
        <ArrowRight size={16} />
      </Button>
    </form>
  );
}
