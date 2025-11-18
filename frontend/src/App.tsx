import { useState } from 'react'
import { ChatInterface } from './components/ChatInterface'
import { AgentStatus } from './components/AgentStatus'
import { ProfileView } from './components/ProfileView'
import { Cpu } from 'lucide-react'

const DEFAULT_USER_ID = 'prashil-bulbule'

function App() {
  const [userId] = useState(DEFAULT_USER_ID)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Header */}
      <header className="border-b border-cyan-500/20 bg-slate-900/50 backdrop-blur">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">
                <Cpu className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
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
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center text-sm font-bold text-white">
                PB
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
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
      <footer className="border-t border-cyan-500/20 bg-slate-900/50 backdrop-blur mt-12">
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
