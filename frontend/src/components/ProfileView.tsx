import { useEffect, useState } from 'react'
import { User, Target, Award, Heart } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Progress } from './ui/progress'
import { chatApi, type UserProfile } from '@/lib/api'
import { formatDate } from '@/lib/utils'

export function ProfileView({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const data = await chatApi.getProfile(userId)
        setProfile(data)
      } catch (error) {
        console.error('Error fetching profile:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchProfile()
  }, [userId])

  if (loading) {
    return (
      <Card className="glass-morphism cyber-glow border-cyan-500/30">
        <CardContent className="p-6">
          <p className="text-cyan-400/60 text-center animate-pulse">Loading profile...</p>
        </CardContent>
      </Card>
    )
  }

  if (!profile) {
    return (
      <Card className="glass-morphism cyber-glow border-cyan-500/30">
        <CardContent className="p-6">
          <p className="text-red-400 text-center">Failed to load profile</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="glass-morphism cyber-glow border-cyan-500/30 relative overflow-hidden">
        <div className="absolute inset-0 animate-holographic pointer-events-none opacity-30"></div>
        <CardHeader className="relative z-10">
          <CardTitle className="flex items-center gap-2 text-cyan-400 neon-text">
            <User className="h-5 w-5 animate-pulse" />
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center text-2xl font-bold text-white cyber-glow animate-pulse-glow">
              {profile.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div>
              <h3 className="text-lg font-bold text-cyan-100">{profile.name}</h3>
              <p className="text-sm text-cyan-400/60 font-mono">{profile.email}</p>
              <p className="text-xs text-cyan-400/40 mt-1">
                Timezone: {profile.preferences.timezone}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-pink-400" />
              <span className="text-sm text-cyan-400/60">Emotional State</span>
            </div>
            <div className="bg-slate-800 p-3 rounded-lg">
              <p className="text-cyan-100 capitalize">
                {profile.emotional_state.current_mood}
              </p>
              <Progress
                value={profile.emotional_state.confidence * 100}
                className="h-2 mt-2"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {profile.goals && profile.goals.length > 0 && (
        <Card className="glass-morphism cyber-glow border-cyan-500/30 relative overflow-hidden">
          <div className="absolute inset-0 animate-holographic pointer-events-none opacity-30"></div>
          <CardHeader className="relative z-10">
            <CardTitle className="flex items-center gap-2 text-cyan-400 neon-text">
              <Target className="h-5 w-5 animate-pulse" />
              Goals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 relative z-10">
            {profile.goals.slice(0, 5).map((goal: any) => (
              <div key={goal.id} className="space-y-2 glass-morphism p-3 rounded-lg border border-cyan-500/20">
                <div className="flex justify-between">
                  <span className="text-sm text-cyan-100">{goal.title}</span>
                  <span className="text-xs text-cyan-400 font-mono">{goal.progress}%</span>
                </div>
                <div className="relative">
                  <Progress value={goal.progress} className="h-2" />
                  <div className="absolute inset-0 bg-gradient-to-r from-cyan-400/20 to-transparent h-2 animate-scan-line"></div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {profile.achievements && profile.achievements.length > 0 && (
        <Card className="glass-morphism cyber-glow border-cyan-500/30 relative overflow-hidden">
          <div className="absolute inset-0 animate-holographic pointer-events-none opacity-30"></div>
          <CardHeader className="relative z-10">
            <CardTitle className="flex items-center gap-2 text-cyan-400 neon-text">
              <Award className="h-5 w-5 animate-pulse" />
              Recent Achievements
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 relative z-10">
            {profile.achievements.slice(0, 3).map((achievement: any) => (
              <div key={achievement.id} className="flex gap-3 glass-morphism p-3 rounded-lg border border-cyan-500/20 hover:border-cyan-400/40 transition-all group">
                <div className="text-2xl animate-float">🏆</div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-cyan-100">{achievement.title}</p>
                  <p className="text-xs text-cyan-400/60">{achievement.description}</p>
                  <p className="text-xs text-cyan-400/40 mt-1 font-mono">
                    {formatDate(achievement.date)}
                  </p>
                </div>
                <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-scan-line"></div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
