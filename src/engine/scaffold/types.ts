export type Confidence = 'high' | 'medium' | 'low';

/** A single proposed props.conf directive (or the special `sourcetype` rename). */
export interface ScaffoldSuggestion {
  /** Directive key (e.g. `TIME_FORMAT`), or `sourcetype` for the rename suggestion. */
  key: string;
  value: string;
  confidence: Confidence;
  /** Human-readable justification shown in the UI (e.g. "matched in 9/10 lines"). */
  evidence: string;
  /** Whether the suggestion's checkbox starts ticked. */
  enabledByDefault: boolean;
}

export interface ScaffoldResult {
  /** Proposed stanza name — the (optionally normalised) sourcetype, or a placeholder. */
  sourcetype: string;
  /** Present when the current sourcetype could be normalised (naming hygiene). */
  sourcetypeSuggestion?: ScaffoldSuggestion;
  /** Directive suggestions for the props.conf stanza. */
  suggestions: ScaffoldSuggestion[];
}
