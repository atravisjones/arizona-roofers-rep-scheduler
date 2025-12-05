import React, { useEffect, useRef } from 'react';
import { LoadingIcon, XIcon } from './icons';

interface AiAssistantPopupProps {
  isOpen: boolean;
  onClose: () => void;
  thoughts: string[];
  isThinking: boolean;
  title: string;
}

const AiAssistantPopup: React.FC<AiAssistantPopupProps> = ({ isOpen, onClose, thoughts, isThinking, title }) => {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
        contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [thoughts]);

  if (!isOpen) return null;

  return (
    <div className="popup-surface fixed bottom-4 right-4 w-96 z-[100] flex flex-col max-h-[50vh] transition-all duration-300 overflow-hidden">
      <header className="p-3 border-b border-border-primary flex justify-between items-center bg-bg-secondary flex-shrink-0">
        <h3 className="text-sm font-bold text-text-primary flex items-center">
          {isThinking && <LoadingIcon />}
          <span className="ml-2">{title}</span>
        </h3>
        <button onClick={onClose} className="text-text-quaternary hover:text-text-secondary">
          <XIcon className="h-5 w-5" />
        </button>
      </header>
      <div ref={contentRef} className="p-3 flex-grow overflow-y-auto">
        <ul className="space-y-2">
          {thoughts.map((thought, index) => (
            <li key={index} className="text-xs text-text-secondary animate-fade-in">{thought}</li>
          ))}
          {isThinking && thoughts.length === 0 && (
            <li className="text-xs text-text-tertiary animate-pulse">Waiting for AI to start thinking...</li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default AiAssistantPopup;