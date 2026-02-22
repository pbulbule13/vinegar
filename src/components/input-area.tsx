"use client";

import { memo, type Ref } from "react";
import { Zap, ChevronDown, Send, Loader2 } from "lucide-react";

const TEXT_MODELS = [
  { group: "Google", models: [
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", tag: "Fast" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", tag: "Smart" },
  ]},
  { group: "OpenAI", models: [
    { id: "gpt-4o-mini", name: "GPT-4o Mini", tag: "Fast" },
  ]},
  { group: "Meta", models: [
    { id: "llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout", tag: "Fast" },
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", tag: "Versatile" },
  ]},
];

interface InputAreaProps {
  textInput: string;
  onTextInputChange: (value: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  isTyping: boolean;
  selectedModel: string;
  onModelChange: (model: string) => void;
  showModelPicker: boolean;
  onToggleModelPicker: () => void;
  inputRef: Ref<HTMLInputElement>;
}

export const InputArea = memo(function InputArea({
  textInput,
  onTextInputChange,
  onSend,
  onKeyDown,
  isTyping,
  selectedModel,
  onModelChange,
  showModelPicker,
  onToggleModelPicker,
  inputRef,
}: InputAreaProps) {
  return (
    <div className="pb-4 pt-2">
      {/* Model selector */}
      <div className="relative mb-2">
        <button
          onClick={onToggleModelPicker}
          className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-mono text-white/30 hover:text-amber-400/60 transition-colors"
        >
          <Zap className="w-2.5 h-2.5" />
          {TEXT_MODELS.flatMap(g => g.models).find(m => m.id === selectedModel)?.name || selectedModel}
          <ChevronDown className={`w-2.5 h-2.5 transition-transform ${showModelPicker ? 'rotate-180' : ''}`} />
        </button>

        {showModelPicker && (
          <>
            <div className="fixed inset-0 z-40" onClick={onToggleModelPicker} />
            <div className="absolute bottom-full left-0 mb-1 z-50 w-64 model-picker">
              {TEXT_MODELS.map((group) => (
                <div key={group.group}>
                  <div className="px-3 py-1.5 text-[9px] font-mono text-white/20 uppercase tracking-[0.2em] bg-black/30">
                    {group.group}
                  </div>
                  {group.models.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => { onModelChange(model.id); onToggleModelPicker(); }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                        selectedModel === model.id
                          ? 'bg-amber-500/10 text-amber-400'
                          : 'text-white/50 hover:bg-white/5 hover:text-white/70'
                      }`}
                    >
                      <span>{model.name}</span>
                      <span className="text-[9px] font-mono text-white/20">{model.tag}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Text input */}
      <div className="input-container">
        <input
          ref={inputRef}
          type="text"
          value={textInput}
          onChange={(e) => onTextInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask Vinegar anything..."
          disabled={isTyping}
          className="flex-1 bg-transparent text-sm text-white/90 placeholder-white/20 px-4 py-3 focus:outline-none disabled:opacity-40"
        />
        <button
          onClick={onSend}
          disabled={!textInput.trim() || isTyping}
          className="send-button"
        >
          {isTyping ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
});
