// Claude models offered in the app. Exact IDs, no date suffixes.

export type ModelId = 'claude-opus-5' | 'claude-sonnet-5' | 'claude-haiku-4-5';

export interface ModelInfo {
  id: ModelId;
  label: string;
  blurb: string;
  /** Adaptive thinking + output_config.effort are supported. */
  adaptive: boolean;
  /** Server-side refusal fallbacks (`fallbacks: "default"`) are enabled for this model. */
  fallbacks: boolean;
}

export const MODELS: ModelInfo[] = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', blurb: 'Most capable · default', adaptive: true, fallbacks: true },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', blurb: 'Near-Opus quality, lower cost', adaptive: true, fallbacks: false },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', blurb: 'Fastest and cheapest', adaptive: false, fallbacks: false },
];

export const DEFAULT_MODEL: ModelId = 'claude-opus-5';

export function modelInfo(id: string): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0]!;
}

/** Beta header for the `fallbacks: "default"` scalar form. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
