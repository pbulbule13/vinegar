/**
 * Speaker Identification Service
 * Pure logic — no React dependency. Testable in isolation.
 *
 * Uses MFCC-based 16-dimensional voice embeddings:
 *   [13 MFCC means, spectralCentroid, spectralRolloff, spectralFlatness]
 *
 * All processing happens on-device. MFCC vectors are non-reversible
 * (cannot reconstruct audio from them).
 */

// ─── Types ───

export interface VoiceEmbedding {
  familyMemberId: string;
  name: string;
  role: "parent" | "child";
  embedding: Float32Array; // 16 floats, L2 normalized
}

export interface IdentificationResult {
  memberId: string;
  name: string;
  role: "parent" | "child";
  confidence: number; // 0-1 cosine similarity
}

export interface StoredVoiceProfile {
  embedding: number[];        // 16 floats, L2 normalized (JSON-safe)
  enrolledAt: number;         // Unix timestamp
  consentTimestamp: number;    // When user gave biometric consent
}

/** Raw features from a single Meyda frame */
export interface MeydaFrame {
  mfcc: number[];               // 13 coefficients
  rms: number;
  spectralCentroid: number;
  spectralRolloff: number;
  spectralFlatness: number;
}

// ─── Constants ───

const EMBEDDING_DIM = 16;
const DEFAULT_THRESHOLD = 0.75;

// VAD thresholds (RMS-based with hysteresis)
export const VAD_START_THRESHOLD = 0.015;  // Start capturing when RMS exceeds this
export const VAD_END_THRESHOLD = 0.008;    // Stop capturing when RMS drops below this
export const VAD_MIN_FRAMES = 20;          // Minimum frames for valid speech (~1s at 2048 buffer / 44.1kHz)
export const VAD_MAX_FRAMES = 60;          // Maximum frames to capture (~3s)
export const VAD_CONSECUTIVE_SILENT = 5;   // Consecutive silent frames to trigger end

// ─── Core Functions ───

/**
 * L2 normalize a vector in-place.
 * Returns the same array for chaining.
 */
export function l2Normalize(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 1e-10) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= norm;
    }
  }
  return vec;
}

/**
 * Cosine similarity between two L2-normalized vectors.
 * For L2-normalized vectors, this is simply the dot product.
 * Returns value in [-1, 1] range (typically 0-1 for voice embeddings).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length !== EMBEDDING_DIM) {
    return 0;
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Compute 16-dimensional feature vector from a set of Meyda frames.
 *
 * Takes the mean of each feature dimension across all frames:
 *   [mfcc_mean_0..12, spectralCentroid_mean, spectralRolloff_mean, spectralFlatness_mean]
 *
 * Then L2 normalizes the result.
 */
export function computeEmbedding(frames: MeydaFrame[]): Float32Array {
  if (frames.length === 0) {
    return new Float32Array(EMBEDDING_DIM);
  }

  const sums = new Float32Array(EMBEDDING_DIM);
  let count = 0;

  for (const frame of frames) {
    // Skip frames with invalid data
    if (!frame.mfcc || frame.mfcc.length < 13) continue;
    if (!isFinite(frame.rms) || frame.rms <= 0) continue;

    // 13 MFCC means
    for (let i = 0; i < 13; i++) {
      if (isFinite(frame.mfcc[i])) {
        sums[i] += frame.mfcc[i];
      }
    }
    // 3 spectral features
    if (isFinite(frame.spectralCentroid)) sums[13] += frame.spectralCentroid;
    if (isFinite(frame.spectralRolloff)) sums[14] += frame.spectralRolloff;
    if (isFinite(frame.spectralFlatness)) sums[15] += frame.spectralFlatness;

    count++;
  }

  if (count === 0) {
    return new Float32Array(EMBEDDING_DIM);
  }

  // Compute means
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    sums[i] /= count;
  }

  return l2Normalize(sums);
}

/**
 * Average multiple embeddings (e.g., from enrollment phrases).
 * Re-normalizes after averaging.
 */
export function averageEmbeddings(embeddings: Float32Array[]): Float32Array {
  if (embeddings.length === 0) return new Float32Array(EMBEDDING_DIM);
  if (embeddings.length === 1) return new Float32Array(embeddings[0]);

  const avg = new Float32Array(EMBEDDING_DIM);
  for (const emb of embeddings) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      avg[i] += emb[i];
    }
  }
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    avg[i] /= embeddings.length;
  }
  return l2Normalize(avg);
}

/**
 * Match a voice embedding against stored profiles.
 * Returns the best match above threshold, or null if no match.
 */
export function identifySpeaker(
  embedding: Float32Array,
  profiles: VoiceEmbedding[],
  threshold: number = DEFAULT_THRESHOLD
): IdentificationResult | null {
  if (profiles.length === 0) return null;

  let bestScore = -1;
  let bestProfile: VoiceEmbedding | null = null;

  for (const profile of profiles) {
    const score = cosineSimilarity(embedding, profile.embedding);
    if (score > bestScore) {
      bestScore = score;
      bestProfile = profile;
    }
  }

  if (!bestProfile || bestScore < threshold) {
    return null;
  }

  return {
    memberId: bestProfile.familyMemberId,
    name: bestProfile.name,
    role: bestProfile.role,
    confidence: bestScore,
  };
}

/**
 * Convert a StoredVoiceProfile (from SQLite JSON) to a VoiceEmbedding.
 */
export function parseStoredProfile(
  memberId: string,
  name: string,
  role: "parent" | "child",
  stored: StoredVoiceProfile
): VoiceEmbedding {
  return {
    familyMemberId: memberId,
    name,
    role,
    embedding: l2Normalize(new Float32Array(stored.embedding)),
  };
}

/**
 * Check if a set of frames has sufficient quality for enrollment/identification.
 * Returns { valid, reason }.
 */
export function validateFrameQuality(frames: MeydaFrame[]): { valid: boolean; reason?: string } {
  if (frames.length < VAD_MIN_FRAMES) {
    return { valid: false, reason: `Too short: ${frames.length} frames (need ${VAD_MIN_FRAMES})` };
  }

  // Check average RMS is above ambient noise
  const avgRms = frames.reduce((sum, f) => sum + f.rms, 0) / frames.length;
  if (avgRms < VAD_START_THRESHOLD * 0.5) {
    return { valid: false, reason: "Audio too quiet. Please speak louder." };
  }

  return { valid: true };
}
