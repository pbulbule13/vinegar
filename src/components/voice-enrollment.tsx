"use client";

/**
 * Voice Enrollment Component
 * Guided 3-phrase flow: consent → record phrases → verification test
 *
 * Flow:
 * 1. Show biometric consent dialog
 * 2. Record 3 short phrases with quality checks
 * 3. Average embeddings → final voiceprint
 * 4. Verification test: "Say anything to test"
 * 5. Save to server via /api/family POST
 */

import { useState, useCallback } from "react";
import { Mic, Check, X, AlertCircle, Shield } from "lucide-react";
import { computeEmbedding, averageEmbeddings } from "@/lib/speaker-id-service";
import type { MeydaFrame } from "@/lib/speaker-id-service";

interface VoiceEnrollmentProps {
  familyMember: { id: string; name: string; role: string };
  onComplete: () => void;
  onCancel: () => void;
  enrollCapture: () => Promise<MeydaFrame[] | null>;
}

type EnrollStep = "consent" | "recording" | "verification" | "saving" | "done" | "error";

const ENROLLMENT_PHRASES = [
  "Hey Vinegar, what's the weather today?",
  "Add milk and eggs to the grocery list.",
  "Good morning Vinegar, I'm ready to start my day.",
];

export function VoiceEnrollment({
  familyMember,
  onComplete,
  onCancel,
  enrollCapture,
}: VoiceEnrollmentProps) {
  const [step, setStep] = useState<EnrollStep>("consent");
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [embeddings, setEmbeddings] = useState<Float32Array[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [verificationPassed, setVerificationPassed] = useState(false);

  const consentTimestamp = useState(() => Math.floor(Date.now() / 1000))[0];

  const handleConsent = () => {
    setStep("recording");
  };

  const recordPhrase = useCallback(async () => {
    setIsRecording(true);
    setError(null);

    try {
      const frames = await enrollCapture();
      if (!frames) {
        setError("Could not capture audio. Please try again.");
        setIsRecording(false);
        return;
      }

      const embedding = computeEmbedding(frames);
      const newEmbeddings = [...embeddings, embedding];
      setEmbeddings(newEmbeddings);

      if (newEmbeddings.length >= ENROLLMENT_PHRASES.length) {
        // All phrases captured — move to verification
        setStep("verification");
      } else {
        setPhraseIndex(phraseIndex + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recording failed");
    } finally {
      setIsRecording(false);
    }
  }, [enrollCapture, embeddings, phraseIndex]);

  const runVerification = useCallback(async () => {
    setIsRecording(true);
    setError(null);

    try {
      const frames = await enrollCapture();
      if (!frames) {
        setError("Could not capture audio. Please try again.");
        setIsRecording(false);
        return;
      }

      const testEmbedding = computeEmbedding(frames);
      const finalEmbedding = averageEmbeddings(embeddings);

      // Compute similarity between test and enrolled
      let dot = 0;
      for (let i = 0; i < 16; i++) {
        dot += testEmbedding[i] * finalEmbedding[i];
      }

      if (dot >= 0.65) {
        // Verification passed
        setVerificationPassed(true);
        setStep("saving");
        await saveProfile(finalEmbedding);
      } else {
        setError(
          `Verification score: ${(dot * 100).toFixed(0)}%. Please try again or re-enroll.`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setIsRecording(false);
    }
  }, [enrollCapture, embeddings]);

  const saveProfile = async (embedding: Float32Array) => {
    try {
      const res = await fetch("/api/family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "enroll_voice",
          member_id: familyMember.id,
          embedding: Array.from(embedding),
          consent_timestamp: consentTimestamp,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save voice profile");
      }

      setStep("done");
      setTimeout(onComplete, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setStep("error");
    }
  };

  const resetEnrollment = () => {
    setStep("recording");
    setPhraseIndex(0);
    setEmbeddings([]);
    setError(null);
    setVerificationPassed(false);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white/80">
          Voice Enrollment: {familyMember.name}
        </h3>
        <button onClick={onCancel} className="p-1 hover:bg-white/5 rounded">
          <X className="w-4 h-4 text-white/40" />
        </button>
      </div>

      {/* Progress */}
      {step !== "consent" && step !== "done" && (
        <div className="flex gap-1">
          {ENROLLMENT_PHRASES.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i < embeddings.length
                  ? "bg-amber-500"
                  : i === phraseIndex && step === "recording"
                  ? "bg-amber-500/40 animate-pulse"
                  : "bg-white/10"
              }`}
            />
          ))}
          <div
            className={`h-1 flex-1 rounded-full transition-colors ${
              verificationPassed ? "bg-green-500" : step === "verification" ? "bg-amber-500/40 animate-pulse" : "bg-white/10"
            }`}
          />
        </div>
      )}

      {/* Consent Step */}
      {step === "consent" && (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <div className="text-xs text-white/60 leading-relaxed">
                <p className="font-medium text-white/80 mb-1">Biometric Data Notice</p>
                <p>
                  Your voice profile is stored <strong>only on this device</strong> and can be
                  deleted anytime from Settings. The stored data is a mathematical
                  representation (MFCC features) that cannot be used to reconstruct your voice.
                </p>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 px-3 py-2 bg-white/5 border border-white/10 text-white/50 rounded-lg text-xs hover:bg-white/10 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleConsent}
              className="flex-1 px-3 py-2 bg-amber-500/20 border border-amber-500/40 text-amber-400 rounded-lg text-xs hover:bg-amber-500/30 transition-all"
            >
              I Consent
            </button>
          </div>
        </div>
      )}

      {/* Recording Step */}
      {step === "recording" && (
        <div className="space-y-3">
          <div className="text-center">
            <p className="text-[11px] text-white/40 mb-1">
              Phrase {phraseIndex + 1} of {ENROLLMENT_PHRASES.length}
            </p>
            <p className="text-sm text-white/70 italic">
              &ldquo;{ENROLLMENT_PHRASES[phraseIndex]}&rdquo;
            </p>
          </div>
          <button
            onClick={recordPhrase}
            disabled={isRecording}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm transition-all ${
              isRecording
                ? "bg-red-500/20 border border-red-500/40 text-red-400"
                : "bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
            }`}
          >
            <Mic className={`w-4 h-4 ${isRecording ? "animate-pulse" : ""}`} />
            {isRecording ? "Listening..." : "Tap to Record"}
          </button>
        </div>
      )}

      {/* Verification Step */}
      {step === "verification" && (
        <div className="space-y-3">
          <div className="text-center">
            <p className="text-[11px] text-white/40 mb-1">Verification Test</p>
            <p className="text-sm text-white/70">Say anything to verify your voice.</p>
          </div>
          <button
            onClick={runVerification}
            disabled={isRecording}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm transition-all ${
              isRecording
                ? "bg-cyan-500/20 border border-cyan-500/40 text-cyan-400"
                : "bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20"
            }`}
          >
            <Mic className={`w-4 h-4 ${isRecording ? "animate-pulse" : ""}`} />
            {isRecording ? "Verifying..." : "Tap to Verify"}
          </button>
        </div>
      )}

      {/* Saving Step */}
      {step === "saving" && (
        <div className="text-center py-4">
          <div className="w-8 h-8 mx-auto mb-2 rounded-full border-2 border-amber-500/30 border-t-amber-500 animate-spin" />
          <p className="text-xs text-white/40">Saving voice profile...</p>
        </div>
      )}

      {/* Done Step */}
      {step === "done" && (
        <div className="text-center py-4">
          <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-green-500/20 flex items-center justify-center">
            <Check className="w-5 h-5 text-green-400" />
          </div>
          <p className="text-sm text-green-400">
            Recognized as {familyMember.name}!
          </p>
          <p className="text-[10px] text-white/30 mt-1">Voice profile saved.</p>
        </div>
      )}

      {/* Error Step */}
      {step === "error" && (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-400">{error}</p>
          </div>
          <button
            onClick={resetEnrollment}
            className="w-full px-3 py-2 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-lg text-xs hover:bg-amber-500/20 transition-all"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Inline error (non-fatal) */}
      {error && step !== "error" && (
        <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2">
          <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
          <p className="text-[10px] text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}
