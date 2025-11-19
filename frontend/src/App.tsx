import { useState } from 'react'
import { ChatInterface } from './components/ChatInterface'
import { AgentStatus } from './components/AgentStatus'
import { ProfileView } from './components/ProfileView'
import { Cpu } from 'lucide-react'

const DEFAULT_USER_ID = 'prashil-bulbule'

function App() {
  const [userId] = useState(DEFAULT_USER_ID)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 grid-background relative overflow-hidden">
      {/* Ambient particles effect */}
      <div className="particles absolute inset-0 opacity-30">
        <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-cyan-400 rounded-full animate-pulse-glow" style={{ animationDelay: '0s' }}></div>
        <div className="absolute top-1/3 right-1/4 w-1 h-1 bg-blue-400 rounded-full animate-pulse-glow" style={{ animationDelay: '1s' }}></div>
        <div className="absolute bottom-1/4 left-1/3 w-1.5 h-1.5 bg-cyan-300 rounded-full animate-pulse-glow" style={{ animationDelay: '2s' }}></div>
        <div className="absolute top-1/2 right-1/3 w-2 h-2 bg-blue-300 rounded-full animate-pulse-glow" style={{ animationDelay: '1.5s' }}></div>
        <div className="absolute bottom-1/3 right-1/2 w-1 h-1 bg-cyan-400 rounded-full animate-pulse-glow" style={{ animationDelay: '0.5s' }}></div>
      </div>

      {/* Scanning line effect */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-10">
        <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-scan-line"></div>
      </div>

      {/* Header */}
      <header className="border-b border-cyan-500/20 glass-morphism backdrop-blur relative z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center animate-pulse-glow">
                <Cpu className="h-6 w-6 text-white animate-float" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent neon-text">
                  VINEGAR AI-OS
                </h1>
                <p className="text-xs text-cyan-400/60">
                  Vigilant Intelligent Networked Assistant
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-semibold text-cyan-100">AIML Agent Guy</p>
                <p className="text-xs text-cyan-400/60">Prashil Bulbule</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center text-sm font-bold text-white cyber-glow">
                PB
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Chat Interface */}
          <div className="lg:col-span-2">
            <ChatInterface userId={userId} />
          </div>

          {/* Right Column - Agent Status & Profile */}
          <div className="space-y-6">
            <AgentStatus />
            <ProfileView userId={userId} />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-cyan-500/20 glass-morphism backdrop-blur mt-12 relative z-10">
        <div className="container mx-auto px-4 py-6">
          <div className="flex justify-between items-center text-sm text-cyan-400/60">
            <p>© 2025 VINEGAR AI-OS - Your Jarvis-like Personal Assistant</p>
            <p>Built with Python, FastAPI, React & Claude AI</p>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default App
