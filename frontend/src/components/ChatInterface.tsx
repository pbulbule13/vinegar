import { useState, useRef, useEffect } from 'react'
import { Send, Mic, MicOff } from 'lucide-react'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { chatApi, type ChatResponse } from '@/lib/api'
import { cn, formatTimeAgo } from '@/lib/utils'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  agentType?: string
}

export function ChatInterface({ userId }: { userId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const response: ChatResponse = await chatApi.sendMessage({
        message: input,
        user_id: userId,
        session_id: sessionId || undefined,
        voice_enabled: voiceEnabled,
      })

      if (!sessionId) {
        setSessionId(response.session_id)
      }

      const assistantMessage: Message = {
        role: 'assistant',
        content: response.response,
        timestamp: new Date(),
        agentType: response.agent_type,
      }

      setMessages(prev => [...prev, assistantMessage])

      // Play audio if available
      if (response.audio_url && voiceEnabled) {
        const audio = new Audio(response.audio_url)
        audio.play().catch(console.error)
      }
    } catch (error) {
      console.error('Error sending message:', error)
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
          timestamp: new Date(),
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <Card className="flex flex-col h-[600px] glass-morphism cyber-glow border-cyan-500/30 relative overflow-hidden">
      {/* Holographic shimmer effect */}
      <div className="absolute inset-0 animate-holographic pointer-events-none"></div>

      {/* Header */}
      <div className="p-4 border-b border-cyan-500/20 relative z-10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-cyan-400 neon-text">VINEGAR AI-OS</h2>
            <p className="text-xs text-cyan-400/60">Your Jarvis-like AI Assistant</p>
          </div>
          <div className="flex items-center gap-2">
            {voiceEnabled && (
              <div className="flex gap-1 items-end h-6">
                <div className="w-1 bg-cyan-400 rounded voice-wave" style={{ animationDelay: '0s' }}></div>
                <div className="w-1 bg-cyan-400 rounded voice-wave" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-1 bg-cyan-400 rounded voice-wave" style={{ animationDelay: '0.2s' }}></div>
                <div className="w-1 bg-cyan-400 rounded voice-wave" style={{ animationDelay: '0.3s' }}></div>
              </div>
            )}
            <Button
              size="icon"
              variant={voiceEnabled ? "default" : "outline"}
              onClick={() => setVoiceEnabled(!voiceEnabled)}
              className={cn(
                voiceEnabled && "bg-cyan-500 hover:bg-cyan-600 animate-pulse-glow"
              )}
            >
              {voiceEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 relative z-10">
        {messages.length === 0 && (
          <div className="text-center py-12 text-cyan-400/40">
            <p className="text-lg neon-text animate-pulse">Ready to assist, sir.</p>
            <p className="text-sm mt-2">How may I be of service?</p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={cn(
              "flex",
              msg.role === 'user' ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={cn(
                "max-w-[80%] rounded-lg p-3 relative",
                msg.role === 'user'
                  ? "bg-cyan-600 text-white cyber-glow"
                  : "glass-morphism text-cyan-100 border border-cyan-500/20"
              )}
            >
              {msg.role === 'assistant' && msg.agentType && (
                <div className="text-xs text-cyan-400 mb-1 font-mono flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse"></div>
                  [{msg.agentType.toUpperCase()}]
                </div>
              )}
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              <p className="text-xs mt-1 opacity-60">
                {formatTimeAgo(msg.timestamp)}
              </p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-700 text-cyan-100 rounded-lg p-3">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
                <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse delay-75" />
                <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse delay-150" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-cyan-500/20 relative z-10">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask VINEGAR anything..."
            className="flex-1 glass-morphism text-cyan-100 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500 border border-cyan-500/20"
            disabled={isLoading}
          />
          <Button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            className="bg-cyan-500 hover:bg-cyan-600 cyber-glow"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  )
}
