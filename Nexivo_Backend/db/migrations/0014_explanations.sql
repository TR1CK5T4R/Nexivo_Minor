-- 0014_explanations: Nexivo M4. Each score gets its contributing factors, an
-- explanation and a recommendation; the text comes from templates in the
-- scoring config (never free text or LLM output).

-- Nullable: scores computed before this migration have no explanation.
ALTER TABLE recovery_scores
  ADD COLUMN contributions   JSONB,
  ADD COLUMN explanation     TEXT,
  ADD COLUMN recommendation  TEXT;

COMMENT ON COLUMN recovery_scores.contributions IS
  'Per parameter, most negative first: [{parameter, raw_value, normalized, baseline, contribution}]. contribution = weight x (normalized - personal baseline), or weight x (normalized - 100) in limited-history mode; they sum to composite - baseline (or composite - 100).';
COMMENT ON COLUMN recovery_scores.explanation IS 'Template text for the top negative (and up to 2 positive) factors.';
COMMENT ON COLUMN recovery_scores.recommendation IS 'Template text chosen by category and top factor. Decision support, not a diagnosis.';

-- Config rows are never edited, so the templates arrive as a new version: the
-- active config's values plus the templates, activated in its place.
INSERT INTO scoring_configs (version, params)
SELECT 'nexivo-1.1', params || '{
  "explanation_templates": {
    "below_baseline": "{label} {worse} to {value} (usual for this patient: {usual}), lowering the score by {points} points.",
    "above_baseline": "{label} {better} to {value} (usual for this patient: {usual}), raising the score by {points} points.",
    "below_ideal": "{label} at {value} is lowering the score by {points} points from the best possible.",
    "steady": "All parameters are close to this patient''s usual values.",
    "at_best": "All parameters are at their best values.",
    "parameters": {
      "pain": { "label": "Pain", "worse": "rose", "better": "eased" },
      "mobility": { "label": "Mobility", "worse": "fell", "better": "improved" },
      "fatigue": { "label": "Fatigue", "worse": "rose", "better": "eased" },
      "symptoms": { "label": "Symptom score", "worse": "fell", "better": "improved" },
      "adherence": { "label": "Medication adherence", "worse": "fell", "better": "improved" },
      "milestones": { "label": "Milestones completed", "worse": "fell", "better": "improved" }
    }
  },
  "recommendation_templates": {
    "attention": "Recommend prompt professional follow-up. Main driver: {factor}.",
    "slower": "Consider reassessment of {area} at the next review.",
    "normal": "Recovery is on track relative to this patient''s baseline. Continue routine monitoring.",
    "areas": {
      "pain": "pain management",
      "mobility": "mobility/physiotherapy plan",
      "symptoms": "symptom review",
      "adherence": "medication adherence",
      "milestones": "recovery plan",
      "fatigue": "fatigue and rest"
    },
    "fallback_factor": "overall recovery trend",
    "fallback_area": "the recovery plan"
  }
}'::jsonb
FROM scoring_configs WHERE active;

UPDATE scoring_configs SET active = false WHERE active AND version <> 'nexivo-1.1';
UPDATE scoring_configs SET active = true WHERE version = 'nexivo-1.1';
