"use client";

/**
 * Speaker Identification Hook
 *
 * React wrapper around speaker-id-service + Meyda.js.
 * Implements sequential handoff: capture audio → extract MFCC → identify → release mic.
 *
 * Key design:
 * - identifyOnce() captures ~1-2s of speech, identifies speaker, then releases mic
 * - NOT continuous — called once at voice session start
 * - Fail-closed: unknown speakers default to child-safe mode
 * - All processing on-device (MFCC vectors never leave the device)
 */

import { useState, useRef, useCallback, useEffect } from "react";
import {
  computeEmbedding,
  identifySpeaker,
  parseStoredProfile,
  validateFrameQuality,
  VAD_START_THRESHOLD,
  VAD_END_THRESHOLD,
  VAD_MIN_FRAMES,
  VAD_MAX_FRAMES,
  VAD_CONSECUTIVE_SILENT,
} from "@/lib/speaker-id-service";
import type {
  IdentificationResult,
  VoiceEmbedding,
  MeydaFrame,
  StoredVoiceProfile,
} from "@/lib/speaker-id-service";

// Re-export for convenience
export type { IdentificationResult };

interface UseSpeakerIdOptions {
  enabled?: boolean;
  onSpeakerIdentified?: (speaker: IdentificationResult | null) => void;
}

interface UseSpeakerIdReturn {
  currentSpeaker: IdentificationResult | null;
  isIdentifying: boolean;
  error: string | null;
  identifyOnce: () => Promise<IdentificationResult | null>;
  enrollCapture: () => Promise<MeydaFrame[] | null>;
}

export function useSpeakerIdentification(
  options: UseSpeakerIdOptions = {}
): UseSpeakerIdReturn {
  const { enabled = false, onSpeakerIdentified } = options;

  const [currentSpeaker, setCurrentSpeaker] = useState<IdentificationResult | null>(null);
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cleanup refs
  const cleanupRef = useRef<(() => void) | null>(null);
  const profilesCacheRef = useRef<VoiceEmbedding[]>([]);
  const profilesLoadedRef = useRef(false);

  // Load voice profiles from server
  const loadProfiles = useCallback(async (): Promise<VoiceEmbedding[]> => {
    if (profilesLoadedRef.current && profilesCacheRef.current.length > 0) {
      return profilesCacheRef.current;
    }

    try {
      const res = await fetch("/api/family/voice-profiles");
      if (!res.ok) return [];
      const data = await res.json();

      const profiles: VoiceEmbedding[] = [];
      for (const member of data.members || []) {
        if (member.voice_profile) {
          try {
            const stored: StoredVoiceProfile =
              typeof member.voice_profile === "string"
                ? JSON.parse(member.voice_profile)
                : member.voice_profile;
            if (stored.embedding && stored.embedding.length === 16) {
              profiles.push(
                parseStoredProfile(member.id, member.name, member.role, stored)
              );
            }
          } catch {
            // Skip invalid profiles
          }
        }
      }

      profilesCacheRef.current = profiles;
      profilesLoadedRef.current = true;
      return profiles;
    } catch {
      return [];
    }
  }, []);

  /**
   * Capture audio frames using Meyda analyzer with VAD.
   * Returns raw MeydaFrame[] for processing.
   * Releases all resources (mic, AudioContext, analyzer) when done.
   */
  const captureFrames = useCallback(async (): Promise<MeydaFrame[]> => {
    // Dynamically import Meyda (client-side only, tree-shakes on server)
    const Meyda = (await import("meyda")).default;

    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let analyzer: any = null;

    const frames: MeydaFrame[] = [];
    let vadActive = false;
    let silentFrameCount = 0;

    try {
      // Get mic access
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);

      return await new Promise<MeydaFrame[]>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          // Return what we have if we got enough frames
          if (frames.length >= VAD_MIN_FRAMES) {
            resolve(frames);
          } else {
            reject(new Error("Timed out waiting for speech"));
          }
        }, 5000); // 5s timeout

        function cleanup() {
          clearTimeout(timeout);
          if (analyzer) {
            try { analyzer.stop(); } catch {}
            analyzer = null;
          }
          if (audioContext && audioContext.state !== "closed") {
            try { audioContext.close(); } catch {}
          }
          if (stream) {
            stream.getTracks().forEach((t) => t.stop());
            stream = null;
          }
        }

        // Store cleanup for external abort
        cleanupRef.current = () => {
          cleanup();
          reject(new Error("Aborted"));
        };

        try {
          analyzer = Meyda.createMeydaAnalyzer({
            audioContext: audioContext!,
            source,
            bufferSize: 2048,
            numberOfMFCCCoefficients: 13,
            featureExtractors: [
              "mfcc",
              "rms",
              "spectralCentroid",
              "spectralRolloff",
              "spectralFlatness",
            ] as const,
            callback: (features: Record<string, unknown>) => {
              const rms = features.rms as number;
              if (!isFinite(rms)) return;

              // VAD with hysteresis
              if (!vadActive) {
                if (rms > VAD_START_THRESHOLD) {
                  vadActive = true;
                  silentFrameCount = 0;
                }
                return; // Skip frames before speech starts
              }

              // We're in speech
              if (rms < VAD_END_THRESHOLD) {
                silentFrameCount++;
                if (silentFrameCount >= VAD_CONSECUTIVE_SILENT) {
                  // Speech ended — enough frames?
                  if (frames.length >= VAD_MIN_FRAMES) {
                    cleanup();
                    resolve(frames);
                    return;
                  }
                  // Not enough, keep listening
                  vadActive = false;
                  silentFrameCount = 0;
                  return;
                }
              } else {
                silentFrameCount = 0;
              }

              // Capture frame
              frames.push({
                mfcc: features.mfcc as number[],
                rms,
                spectralCentroid: features.spectralCentroid as number,
                spectralRolloff: features.spectralRolloff as number,
                spectralFlatness: features.spectralFlatness as number,
              });

              // Max frames reached
              if (frames.length >= VAD_MAX_FRAMES) {
                cleanup();
                resolve(frames);
              }
            },
          });

          analyzer.start();
        } catch (err) {
          cleanup();
          reject(err);
        }
      });
    } catch (err) {
      // Ensure cleanup on any error
      if (analyzer) try { analyzer.stop(); } catch {}
      if (audioContext && audioContext.state !== "closed") try { audioContext.close(); } catch {}
      if (stream) stream.getTracks().forEach((t) => t.stop());
      throw err;
    }
  }, []);

  /**
   * Identify the current speaker.
   * Captures ~1-2s of audio, extracts features, matches against profiles.
   * Releases all audio resources when done (sequential handoff for STT).
   */
  const identifyOnce = useCallback(async (): Promise<IdentificationResult | null> => {
    if (!enabled) return null;
    if (isIdentifying) return null;

    setIsIdentifying(true);
    setError(null);

    try {
      // Load profiles first
      const profiles = await loadProfiles();
      if (profiles.length === 0) {
        // No enrolled profiles — skip identification
        setIsIdentifying(false);
        setCurrentSpeaker(null);
        onSpeakerIdentified?.(null);
        return null;
      }

      // Capture audio frames
      const frames = await captureFrames();

      // Validate quality
      const quality = validateFrameQuality(frames);
      if (!quality.valid) {
        setError(quality.reason || "Audio quality insufficient");
        setIsIdentifying(false);
        setCurrentSpeaker(null);
        onSpeakerIdentified?.(null);
        return null;
      }

      // Compute embedding and match
      const embedding = computeEmbedding(frames);
      const result = identifySpeaker(embedding, profiles);

      setCurrentSpeaker(result);
      setIsIdentifying(false);
      onSpeakerIdentified?.(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Speaker identification failed";
      if (msg !== "Aborted") {
        setError(msg);
      }
      setIsIdentifying(false);
      setCurrentSpeaker(null);
      onSpeakerIdentified?.(null);
      return null;
    }
  }, [enabled, isIdentifying, loadProfiles, captureFrames, onSpeakerIdentified]);

  /**
   * Capture audio frames for enrollment (no identification).
   * Used by voice-enrollment component.
   */
  const enrollCapture = useCallback(async (): Promise<MeydaFrame[] | null> => {
    try {
      const frames = await captureFrames();
      const quality = validateFrameQuality(frames);
      if (!quality.valid) {
        setError(quality.reason || "Audio quality insufficient");
        return null;
      }
      return frames;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Capture failed";
      setError(msg);
      return null;
    }
  }, [captureFrames]);

  // Invalidate profile cache when needed
  useEffect(() => {
    // Reset cache when enabled changes so profiles reload
    profilesLoadedRef.current = false;
  }, [enabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  return {
    currentSpeaker,
    isIdentifying,
    error,
    identifyOnce,
    enrollCapture,
  };
}
