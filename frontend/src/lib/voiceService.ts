/**
 * Voice Service for VINEGAR AI-OS
 * Handles both speech recognition (input) and speech synthesis (output)
 */

interface VoiceServiceConfig {
  language?: string
  continuous?: boolean
  interimResults?: boolean
  onResult?: (transcript: string, isFinal: boolean) => void
  onError?: (error: string) => void
  onStart?: () => void
  onEnd?: () => void
}

class VoiceService {
  private recognition: SpeechRecognition | null = null
  private synthesis: SpeechSynthesis
  private isListening: boolean = false
  private config: VoiceServiceConfig = {}

  constructor() {
    this.synthesis = window.speechSynthesis
    this.initRecognition()
  }

  /**
   * Initialize speech recognition
   */
  private initRecognition() {
    // Check if browser supports speech recognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (!SpeechRecognition) {
      console.error('[VINEGAR Voice] Speech recognition not supported in this browser')
      return
    }

    try {
      this.recognition = new SpeechRecognition()
      console.log('[VINEGAR Voice] Speech recognition initialized successfully')
    } catch (error) {
      console.error('[VINEGAR Voice] Error initializing speech recognition:', error)
    }
  }

  /**
   * Check if voice input is supported
   */
  isInputSupported(): boolean {
    const supported = this.recognition !== null
    console.log('[VINEGAR Voice] Input supported:', supported)
    return supported
  }

  /**
   * Check if voice output is supported
   */
  isOutputSupported(): boolean {
    const supported = 'speechSynthesis' in window
    console.log('[VINEGAR Voice] Output supported:', supported)
    return supported
  }

  /**
   * Start listening for voice input
   */
  startListening(config: VoiceServiceConfig = {}) {
    console.log('[VINEGAR Voice] Starting voice recognition...')

    if (!this.recognition) {
      const error = 'Speech recognition not available'
      console.error('[VINEGAR Voice]', error)
      config.onError?.(error)
      return
    }

    if (this.isListening) {
      console.warn('[VINEGAR Voice] Already listening')
      return
    }

    this.config = { ...this.config, ...config }

    // Configure recognition
    this.recognition.continuous = config.continuous ?? false
    this.recognition.interimResults = config.interimResults ?? true
    this.recognition.lang = config.language ?? 'en-US'

    // Set up event handlers
    this.recognition.onstart = () => {
      this.isListening = true
      console.log('[VINEGAR Voice] Recognition started')
      config.onStart?.()
    }

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      console.log('[VINEGAR Voice] Recognition result received')

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0].transcript
        const isFinal = result.isFinal

        console.log('[VINEGAR Voice] Transcript:', transcript, 'Final:', isFinal)
        config.onResult?.(transcript, isFinal)
      }
    }

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('[VINEGAR Voice] Recognition error:', event.error)
      this.isListening = false
      config.onError?.(event.error)
    }

    this.recognition.onend = () => {
      this.isListening = false
      console.log('[VINEGAR Voice] Recognition ended')
      config.onEnd?.()
    }

    // Request microphone permission and start
    try {
      this.recognition.start()
      console.log('[VINEGAR Voice] Recognition start requested')
    } catch (error) {
      console.error('[VINEGAR Voice] Error starting recognition:', error)
      config.onError?.(error instanceof Error ? error.message : 'Failed to start recognition')
    }
  }

  /**
   * Stop listening for voice input
   */
  stopListening() {
    console.log('[VINEGAR Voice] Stopping voice recognition...')

    if (!this.recognition) {
      console.warn('[VINEGAR Voice] No recognition instance to stop')
      return
    }

    if (!this.isListening) {
      console.warn('[VINEGAR Voice] Not currently listening')
      return
    }

    try {
      this.recognition.stop()
      console.log('[VINEGAR Voice] Recognition stopped')
    } catch (error) {
      console.error('[VINEGAR Voice] Error stopping recognition:', error)
    }
  }

  /**
   * Speak text using browser's speech synthesis
   */
  speak(text: string, options: {
    rate?: number
    pitch?: number
    volume?: number
    voice?: SpeechSynthesisVoice
    onStart?: () => void
    onEnd?: () => void
    onError?: (error: string) => void
  } = {}) {
    console.log('[VINEGAR Voice] Speaking text:', text.substring(0, 50) + '...')

    if (!this.isOutputSupported()) {
      console.error('[VINEGAR Voice] Speech synthesis not supported')
      options.onError?.('Speech synthesis not supported')
      return
    }

    // Cancel any ongoing speech
    this.stopSpeaking()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = options.rate ?? 1.0
    utterance.pitch = options.pitch ?? 1.0
    utterance.volume = options.volume ?? 1.0

    if (options.voice) {
      utterance.voice = options.voice
    }

    utterance.onstart = () => {
      console.log('[VINEGAR Voice] Speech started')
      options.onStart?.()
    }

    utterance.onend = () => {
      console.log('[VINEGAR Voice] Speech ended')
      options.onEnd?.()
    }

    utterance.onerror = (event) => {
      console.error('[VINEGAR Voice] Speech error:', event.error)
      options.onError?.(event.error)
    }

    try {
      this.synthesis.speak(utterance)
      console.log('[VINEGAR Voice] Speech queued')
    } catch (error) {
      console.error('[VINEGAR Voice] Error speaking:', error)
      options.onError?.(error instanceof Error ? error.message : 'Failed to speak')
    }
  }

  /**
   * Play audio from base64 or URL
   */
  async playAudio(audioData: string): Promise<void> {
    console.log('[VINEGAR Voice] Playing audio...')

    return new Promise((resolve, reject) => {
      try {
        const audio = new Audio(audioData)

        audio.onloadeddata = () => {
          console.log('[VINEGAR Voice] Audio loaded successfully')
        }

        audio.onplay = () => {
          console.log('[VINEGAR Voice] Audio playback started')
        }

        audio.onended = () => {
          console.log('[VINEGAR Voice] Audio playback ended')
          resolve()
        }

        audio.onerror = (error) => {
          console.error('[VINEGAR Voice] Audio playback error:', error)
          reject(new Error('Failed to play audio'))
        }

        audio.play().catch(error => {
          console.error('[VINEGAR Voice] Error starting audio playback:', error)
          reject(error)
        })
      } catch (error) {
        console.error('[VINEGAR Voice] Error creating audio element:', error)
        reject(error)
      }
    })
  }

  /**
   * Stop speaking
   */
  stopSpeaking() {
    if (this.synthesis.speaking) {
      console.log('[VINEGAR Voice] Cancelling speech')
      this.synthesis.cancel()
    }
  }

  /**
   * Get available voices
   */
  getVoices(): SpeechSynthesisVoice[] {
    const voices = this.synthesis.getVoices()
    console.log('[VINEGAR Voice] Available voices:', voices.length)
    return voices
  }

  /**
   * Get current listening state
   */
  getIsListening(): boolean {
    return this.isListening
  }

  /**
   * Get current speaking state
   */
  getIsSpeaking(): boolean {
    return this.synthesis.speaking
  }
}

// Export singleton instance
export const voiceService = new VoiceService()
export default voiceService
