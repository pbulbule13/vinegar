import { useEffect, useState } from 'react'
import { Activity, Brain, Calendar, Heart } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Progress } from './ui/progress'
import { chatApi, type SystemMetrics } from '@/lib/api'

export function AgentStatus() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null)

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const data = await chatApi.getMetrics()
        setMetrics(data)
      } catch (error) {
        console.error('Error fetching metrics:', error)
      }
    }

    fetchMetrics()
    const interval = setInterval(fetchMetrics, 5000) // Update every 5 seconds

    return () => clearInterval(interval)
  }, [])

  const agents = [
    {
      name: 'Executive',
      icon: Calendar,
      status: 'online',
      description: 'Email & Calendar Management',
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
    },
    {
      name: 'Emotional',
      icon: Heart,
      status: 'online',
      description: 'Sentiment & Motivation',
      color: 'text-pink-400',
      bgColor: 'bg-pink-500/10',
    },
    {
      name: 'Prioritization',
      icon: Brain,
      status: 'online',
      description: 'Strategy & Foresight',
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10',
    },
  ]

  return (
    <div className="space-y-4">
      <Card className="glass-morphism cyber-glow border-cyan-500/30 relative overflow-hidden">
        <div className="absolute inset-0 animate-holographic pointer-events-none opacity-50"></div>
        <CardHeader className="relative z-10">
          <CardTitle className="flex items-center gap-2 text-cyan-400 neon-text">
            <Activity className="h-5 w-5 animate-pulse" />
            System Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 relative z-10">
          {metrics && (
            <>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-cyan-400/60">Response Latency</span>
                  <span className="text-cyan-400 font-mono">{metrics.response_latency.toFixed(0)}ms</span>
                </div>
                <div className="relative">
                  <Progress value={(500 - metrics.response_latency) / 5} className="h-2" />
                  <div className="absolute inset-0 bg-gradient-to-r from-cyan-400/20 to-transparent animate-scan-line h-2"></div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1 glass-morphism p-3 rounded-lg border border-cyan-500/20">
                  <p className="text-xs text-cyan-400/60">Requests</p>
                  <p className="text-2xl font-bold text-cyan-400 neon-text font-mono">{metrics.request_count}</p>
                </div>
                <div className="space-y-1 glass-morphism p-3 rounded-lg border border-cyan-500/20">
                  <p className="text-xs text-cyan-400/60">Uptime</p>
                  <p className="text-2xl font-bold text-cyan-400 neon-text font-mono">
                    {Math.floor(metrics.uptime / 3600)}h
                  </p>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-cyan-400/60">Error Rate</p>
                <div className="flex items-center gap-2">
                  <Progress value={(1 - metrics.error_rate) * 100} className="h-2 flex-1" />
                  <span className="text-xs text-cyan-400">
                    {(metrics.error_rate * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="glass-morphism cyber-glow border-cyan-500/30 relative overflow-hidden">
        <div className="absolute inset-0 animate-holographic pointer-events-none opacity-50"></div>
        <CardHeader className="relative z-10">
          <CardTitle className="text-cyan-400 neon-text">Active Agents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 relative z-10">
          {agents.map((agent) => (
            <div
              key={agent.name}
              className={`flex items-center gap-3 p-3 rounded-lg ${agent.bgColor} glass-morphism border border-cyan-500/20 relative group hover:border-cyan-400/40 transition-all`}
            >
              <div className={`p-2 rounded-lg bg-slate-800 ${agent.color} animate-pulse-glow`}>
                <agent.icon className="h-5 w-5 animate-float" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-cyan-100">{agent.name}</p>
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse-glow" />
                    <div className="w-1 h-1 bg-green-300 rounded-full animate-pulse-glow" style={{ animationDelay: '0.5s' }} />
                  </div>
                </div>
                <p className="text-xs text-cyan-400/60">{agent.description}</p>
              </div>
              {/* Circuit animation on hover */}
              <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-scan-line"></div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
