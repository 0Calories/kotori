-- Ask Kotori drafts move to the dictionary's own model (`DraftEntry` in proposals.ts). Every
-- field is carried over, nothing is inferred:
--   currency      archaic/dated -> the `arch`/`dated` label on every sense, as approval added it;
--                 familiarity 1/2/4 as approval derived it (trendy and current are both 4).
--   partOfSpeech  -> pos: [code], or [] when null.
--   labels        kept as written; codes outside the label vocabulary are ignored where read.
--   note          -> the sense's one pattern, or none when empty.
--   pitfalls      [] (old drafts had none: their notes say what they warned about, as patterns).
-- Drafts already in the new shape (they have `pitfalls`) are left alone, so this can run twice.
UPDATE "proposals" AS p
SET "draft" = jsonb_build_object(
  'headword', p."draft"->'headword',
  'reading', p."draft"->'reading',
  'spellings', coalesce(p."draft"->'spellings', '[]'::jsonb),
  'familiarity', CASE p."draft"->>'currency' WHEN 'archaic' THEN 1 WHEN 'dated' THEN 2 ELSE 4 END,
  'senses', coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'glosses', coalesce(s.sense->'glosses', '[]'::jsonb),
        'pos', CASE
          WHEN nullif(s.sense->>'partOfSpeech', '') IS NULL THEN '[]'::jsonb
          ELSE jsonb_build_array(s.sense->'partOfSpeech')
        END,
        'labels', (
          SELECT coalesce(jsonb_agg(l.code ORDER BY l.first), '[]'::jsonb)
          FROM (
            SELECT code, min(n) AS first
            FROM jsonb_array_elements_text(
              coalesce(s.sense->'labels', '[]'::jsonb) || CASE p."draft"->>'currency'
                WHEN 'archaic' THEN '["arch"]'::jsonb
                WHEN 'dated' THEN '["dated"]'::jsonb
                ELSE '[]'::jsonb
              END
            ) WITH ORDINALITY AS c(code, n)
            GROUP BY code
          ) AS l
        ),
        'patterns', CASE
          WHEN nullif(btrim(s.sense->>'note'), '') IS NULL THEN '[]'::jsonb
          ELSE jsonb_build_array(btrim(s.sense->>'note'))
        END
      )
      ORDER BY s.n
    )
    FROM jsonb_array_elements(p."draft"->'senses') WITH ORDINALITY AS s(sense, n)
  ), '[]'::jsonb),
  'pitfalls', '[]'::jsonb
)
WHERE p."draft" IS NOT NULL AND NOT (p."draft" ? 'pitfalls');
