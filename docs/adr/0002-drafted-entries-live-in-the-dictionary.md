# Drafted entries live in the dictionary, unreviewed

A drafted entry holds exactly the data a dictionary entry does; the only difference is that the admin hasn't reviewed it. So Ask Kotori writes drafts straight into the dictionary's own tables (`entries` and its forms, senses and cautions) with a Kotori source and a review state (`unreviewed`, `approved`, `discarded`), and the separate `proposals` table with its `DraftEntry` JSONB retires. Approval then changes only the review state: cards, saved notes and duplicate checks already point at the same entry. The cost is that every dictionary read must respect the review state: search marks `unreviewed` entries as unverified and ranks them below approved ones, and hides `discarded` ones from everyone, though they stay as a negative cache and learners who saved one still see it marked "not added".

## Considered Options

- **Keep drafts in a separate `proposals` table** and copy them into `entries` on approval. This keeps the dictionary free of unreviewed rows, but it means two shapes for the same data, a duplicate check across two tables, and notes and cards that have to be repointed when a draft is approved.
