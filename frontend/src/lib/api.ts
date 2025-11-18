import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

export interface ChatMessage {
  message: string
  user_id?: string
  session_id?: string
  voice_enabled?: boolean
}

export interface ChatResponse {
  response: string
  session_id: string
  agent_type: string
  audio_url?: string
  actions: any[]
}

export interface SystemMetrics {
  active_agents: number
  response_latency: number
  tokens_used: number
  uptime: number
  request_count: number
  error_rate: number
}

export interface UserProfile {
  id: string
  name: string
  email: string
  preferences: {
    wake_word: string
    voice_id: string
    timezone: string
    working_hours: {
      start: string
      end: string
    }
  }
  goals: any[]
  achievements: any[]
  emotional_state: {
    current_mood: string
    confidence: number
    timestamp: string
  }
}

export const chatApi = {
  sendMessage: (data: ChatMessage): Promise<ChatResponse> =>
    api.post('/chat', data).then(res => res.data),

  getMetrics: (): Promise<SystemMetrics> =>
    api.get('/metrics').then(res => res.data),

  getProfile: (userId: string): Promise<UserProfile> =>
    api.get(`/profile/${userId}`).then(res => res.data),

  initializeProfile: (userId: string): Promise<any> =>
    api.post(`/profile/${userId}/initialize`).then(res => res.data),
}

export const createWebSocket = (userId: string): WebSocket => {
  const wsUrl = API_BASE_URL.replace('http', 'ws')
  return new WebSocket(`${wsUrl}/ws/${userId}`)
}
