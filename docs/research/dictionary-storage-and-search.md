# Dictionary Storage & Hybrid Search Architecture: First-Principles Research

> **Scope**: First-principles evaluation of storage and search architectures for Kotori's bidirectional Japanese/English dictionary (~250k–350k `Entry` documents, ~200–400 MB raw JSON plus vector embeddings), evaluated against primary documentation, source repositories, and empirical verification.

---

## 1. Executive Summary & Architectural Verdict

### Three First-Principles Realities of Bilingual Dictionary Search

1. **Dictionary search is structurally different from document full-text search — no built-in search engine analyzer solves EN + JP inflectional lookup alone.**
   - **English**: Every mainstream search engine's built-in English stemmer (PostgreSQL `english` Snowball, Lucene `lucene.english` / `PorterStemFilter`, Tantivy `Stemmer`, Typesense `stem: true`, SQLite `FTS5 porter`) uses **algorithmic suffix stripping** ([Snowball Porter2 Spec][snowball-en]; [PostgreSQL FTS Dictionaries][pg-fts-dict]; [Lucene `EnglishAnalyzer`][lucene-en]). None resolve irregular verbs (`ran` → `run`, `went` → `go`, `caught` → `catch`), irregular plurals (`mice` → `mouse`), or inflected multi-word phrasal verbs (`ran into` → `run into`, `"skating on thin ice"` → `"skate on thin ice"`).
   - **Japanese**: Engines that advertise Japanese tokenization split into two camps: (a) **surface-only segmenters** like Meilisearch's Charabia (`lindera-ipadic`) and Typesense (`locale: "ja"` ICU segmentation), which split text into surface tokens **without lemmatizing conjugated verbs to their dictionary `Form`** (`走った` does not normalize to `走る`; [Meilisearch Charabia][charabia-gh], [Charabia #131][charabia-131], [Typesense Locales][typesense-locale]); and (b) **IPADIC morphological lemmatizers** like Lucene Kuromoji (`JapaneseTokenizer` + `JapaneseBaseFormFilter`) and PGroonga (`TokenMecab("use_base_form", true)`), which handle textbook multi-auxiliary chains (`食べさせられた` → `食べる`) via IPADIC (`~2000` newspaper corpus) ([Lucene `ja` Package][lucene-ja]; [Groonga `TokenMecab`][groonga-mecab]), but degrade on colloquial contractions (`食べちゃった`, `読んじゃう`, `行かなきゃ`), *ra-nuki* forms (`見れる`, `来れる`), modern neologisms (`ググった`, `推し活`), and rōmaji queries (`tabesaserareta`).
   - **Implication**: Regardless of which storage/search engine Kotori chooses, **morphological normalization belongs in deterministic application code** (rule-based Japanese deinflection + Sudachi/JMDict forms + English irregular/phrasal lemmatization + rōmaji↔kana conversion at index and query time), turning the database/search index into a fast token, prefix, n-gram, and vector retrieval engine.

2. **Schema churn is caused by relational normalization of nested `Entry` fields, not by SQL itself.**
   - Splitting an `Entry` across `entries`, `entry_forms`, `entry_senses`, `glosses`, `cautions`, `examples`, and `usage_notes` forces SQL DDL migrations and multi-table backfills every time AI `Enrichment` evolves.
   - Storing the canonical `Entry` (including `Enrichment`, `Usage`, `Caution`s, examples, and audio metadata) as a **single Effect/TypeScript-validated document** (`jsonb` in Postgres/SQLite, BSON in MongoDB, or JSON in a document search engine) eliminates DDL migrations on `Enrichment` churn completely. Only the thin, deterministic **search projection** (derived searchable strings, filter scalars like `language` / `review_state` / `frequency`, and the embedding vector) is indexed.

3. **Kotori's dictionary is mutable at runtime and shares foreign-key boundaries with transactional user data.**
   - Per [ADR 0002](../adr/0002-drafted-entries-live-in-the-dictionary.md), `Ask Kotori` writes `Drafted entry` records (`unreviewed` → `approved` | `discarded`) live into the dictionary at user request time, and background `Enrichment` workers continuously mutate `Entry` payloads. Meanwhile, transactional ACID storage is mandatory anyway for users, `Notebook` saved entries + SRS scheduling, and `Ask Kotori` `Conversation`s/`Turn`s. Every secondary search engine or read-only embedded file adds a cross-store synchronization pipeline and dual-store test surface.

### Top Architectural Recommendations (Ranked)

| Rank | Architecture | Moving Parts | Monthly Prod Cost (<10 MAU) | Zero-Docker `pnpm test` | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1 (Recommended)** | **PostgreSQL Single-Document (`jsonb`) + Derived Search Projection (`tsvector` + CJK Bigrams + `pg_trgm` + `pgvector` `halfvec`) + App-Layer Morphological Expansion** | **1** (Postgres only) | **$0–$15/mo** (Neon Launch / Railway / Supabase) | **Yes** (`@electric-sql/pglite` natively ships `vector`, `pg_trgm`, `fuzzystrmatch`) | Best overall balance of zero DDL churn, full SQL ranking & RRF hybrid control, universal managed hosting, and zero-container local tests. |
| **2 (Runner-Up)** | **PostgreSQL (`jsonb` source of truth) + Typesense Sidecar (derived hybrid search index)** | **2** (Postgres + Typesense) | **~$22–$37/mo** (Neon + Typesense Cloud or Railway 2 GB RAM container) | **Partial** (requires mocking search port or spawning Typesense binary) | Best upgrade path if sub-10ms keystroke-by-keystroke typo-tolerant prefix search becomes a bottleneck; adds dual-write/sync operational overhead now. |
| **3** | **MongoDB Atlas (`Entry` BSON + Atlas Search `lucene.japanese` + `$vectorSearch` + `$rankFusion`)** | **1 cloud vendor** (`mongod` + `mongot` under the hood) | **~$58+/mo** (M10 required; M0 512 MB cap too small for 350k docs + vectors) | **No** (`mongodb-atlas-local` requires Docker + multi-GB JVM `mongot`) | Strongest native document + Lucene Kuromoji + HNSW stack, but locks Kotori to MongoDB Atlas and breaks lightweight containerless testing. |
| **4 (Specialized)** | **SQLite (`jsonb` + `FTS5` + `sqlite-vec`) / LibSQL** | **1 file** (single-node only) | **~$5–$10/mo** (Railway volume / Fly / Turso) | **Yes** (in-memory SQLite) | Unbeatable for a future **offline mobile dictionary bundle** in Expo, but single-writer file locking and brute-force/quantized vector scans make it awkward across separate HTTP + `Enrichment` worker services. |

---

## 2. Requirements & Workload Sizing Math

### Dataset & Memory Footprint (~350,000 `Entry` Documents)

- **Raw Document Payload**: ~210k Japanese `Entry` records (JMDict + Kotori `Enrichment`), ~50k–100k English `Entry` records, plus `Ask Kotori` `Drafted entry` records ≈ **300k–350k documents** (~0.8–1.2 KB average compressed/compact JSON, larger when fully enriched) ≈ **250–400 MB raw JSON**.
- **Vector Embeddings Footprint** (1 vector per `Entry`, or ~1.5 vectors per `Entry` if indexing dense multi-sense entries per `Sense` cluster — ~350k to 500k vectors):
  - `1024` dimensions @ `float32` (4 bytes): $350,000 \times 1024 \times 4\text{ B} \approx \mathbf{1.43\text{ GB}}$ raw vectors (~1.8–2.5 GB with HNSW graph edges at $M=16$) ([pgvector HNSW][pgvector-gh]; [Typesense Vector RAM][typesense-sysreq]).
  - `1024` dimensions @ `float16` (`halfvec`, 2 bytes): $350,000 \times 1024 \times 2\text{ B} \approx \mathbf{716\text{ MB}}$ raw vectors (~850 MB–1.1 GB HNSW index) ([pgvector `halfvec`][pgvector-gh]).
  - `512` dimensions (Matryoshka truncated) @ `float16` (`halfvec`, 2 bytes): $350,000 \times 512 \times 2\text{ B} \approx \mathbf{358\text{ MB}}$ raw vectors (~430–550 MB HNSW index).

> **Key Sizing Takeaway**: At 350k entries, the text dictionary is tiny (~300 MB), whereas **uncompressed 1536d `float32` embeddings (~2.15 GB + HNSW overhead) dominate RAM and cost** by 5–8×. Using **512d–1024d Matryoshka embeddings stored as `float16` (`halfvec`) or `int8` scalar-quantized vectors** shrinks total index memory under **500 MB–1 GB** with <1% retrieval recall loss ([OpenAI MRL][openai-emb3]; [Voyage MRL & Quantization][voyage-emb]).

---

## 3. Linguistic & Inflection Deep Dive: Built-in Analyzers vs. Morphological Layer

A dictionary lookup query behaves very differently from prose search: users paste conjugated verbs from native media (`食べさせられた`, `食べちゃった`, `"ran into"`, `"mice"`), type rōmaji (`tabesaserareta`), or search partial idioms (`"thin ice"`), expecting the canonical dictionary `Entry` (`食べる`, `run into`, `mouse`, `skate on thin ice`) to rank **#1**.

### 3.1 Japanese Inflections: Kuromoji, Lindera, Sudachi, MeCab, ICU & Rule-Based Deinflection

How each analyzer handles Kotori's representative Japanese inflection test cases:

| Input Query | Linguistic Phenomenon | **Kuromoji (`lucene.japanese`)** & **PGroonga (`TokenMecab` + `use_base_form`)** (IPADIC) | **Meilisearch Charabia (`lindera-ipadic`)** & **Typesense (`locale: "ja"` ICU)** | **Sudachi (`SudachiDict`, Mode A + Normalization)** | **Rule-Based Deinflector** (JMDict/Yomitan suffix grammar) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `走った` | Godan *onbin* past (`走る` + `た`) | Segments `走っ` (baseForm: `走る`) + `た` (aux); `BaseFormFilter` emits **`走る`** | Emits surface `走っ` + `た` — **fails exact token match on `走る`** | Normalizes `走っ` → **`走る`** + `た` | Strips `-った` → **`走る`** (`v5r`), `走う`, `走つ` (validated against known `Form`s) |
| `食べさせられた` | Multi-auxiliary causative-passive past (`食べる` + `させる` + `られる` + `た`) | Segments `食べ` (baseForm: `食べる`) + `させ` + `られ` + `た`; POS stop-filter drops `助動詞`, leaving **`食べる`** | Emits surface `食べ` + `させ` + `られ` + `た` — `食べ` ≠ `食べる` | Emits lemma **`食べる`** + auxiliaries | Iteratively strips `た` → `られる` → `させる` → **`食べる`** (`v1`) |
| `高くない` | *i*-adjective negative (`高い` + `ない`) | Segments `高く` (baseForm: `高い`) + `ない` (`助動詞` / `形容詞`); emits **`高い`** | Emits surface `高く` + `ない` — `高く` ≠ `高い` | Emits lemma **`高い`** + `ない` | Strips `-くない` → **`高い`** (`adj-i`) |
| `静かだった` | *na*-adjective past copula (`静か` + `だ` + `た`) | Segments `静か` (noun/adj-na stem) + `だっ` + `た`; drops copula/aux, emitting **`静か`** | Emits `静か` + `だっ` + `た` (matches `静か` because *na*-adj stem is invariant) | Emits **`静か`** + `だ` + `た` | Strips `-だった` → **`静か`** |
| `食べちゃった` / `見れる` | Colloquial `-ちゃう` contraction (`食べてしまう`) & *ra-nuki* potential (`見られる`) | **Fragile in IPADIC**: `ちゃっ` / *ra-nuki* forms are often glued or mis-tagged depending on verb OOV status | Surface-only; **fails to map to `食べる` or `見る`** | **Strong**: Mode A + SudachiDict normalization maps colloquial variants cleanly | **Strong & explicit**: grammar table includes `-ちゃう` → `-て` → `食べる` and *ra-nuki* `-れる` → `見る` |
| `ググった` / `バズってる` | Modern loan/slang verb conjugation | **Fails OOV**: IPADIC (~2000) lacks `ググる`/`バズる`, shattering katakana or failing base-form recovery | Surface-only | **Strong** if in active `SudachiDict`, else OOV fallback | **Deterministic**: strips `-った`/`-ってる` → **`ググる`** / **`バズる`** even for brand-new `Drafted entry` words! |
| `tabesaserareta` / `タベル` | Rōmaji input & katakana script variant | **No rōmaji conversion** in standard `lucene.japanese` (`JapaneseReadingFormFilter` only maps kanji→katakana, not rōmaji→kana) | No rōmaji→kana deinflection | Normalizes katakana/hiragana variants; **no rōmaji deinflection** | Convert rōmaji → hiragana (`たべさせられた`), then deinflect → **`たべる`** (`食べる`) |

**Primary Source Verification**:
- Apache Lucene's `JapaneseAnalyzer` runs `JapaneseTokenizer` (Viterbi over IPADIC) → `JapaneseBaseFormFilter` (replaces conjugated `TermAttribute` with `BaseFormAttribute`) → `JapanesePartOfSpeechStopFilter` (drops `助動詞` auxiliary verbs and `助詞` particles) → `CJKWidthFilter` → `JapaneseKatakanaStemFilter` ([Lucene `org.apache.lucene.analysis.ja` Docs][lucene-ja]; [Lucene `JapaneseBaseFormFilter`][lucene-baseform]).
- Meilisearch's `charabia` uses `lindera-ipadic` solely for **word boundary segmentation**, not morphological base-form replacement ([`meilisearch/charabia` GitHub][charabia-gh]; [Charabia Issue #131][charabia-131]; [Meilisearch Discussion #532][meili-532]).
- Typesense's `locale: "ja"` relies on ICU break iteration / script segmentation in `tokenizer.cpp`; its `stem: true` Snowball stemmer does not cover Japanese verb conjugations ([Typesense Multilingual Docs][typesense-locale]; [Typesense Stemming Docs][typesense-stem]).
- PGroonga's `TokenMecab` defaults to surface tokens unless explicitly configured with `TokenMecab("use_base_form", true)` (Groonga 9.1.0+) ([Groonga `TokenMecab` Docs][groonga-mecab]; [PGroonga Tokenizers][pgroonga-tok]).
- Works Applications' **Sudachi** provides multi-granular segmentation (Mode A short morphemes, Mode B middle compounds, Mode C named entities/idioms) and an actively updated dictionary (`SudachiDict`) that handles modern vocabulary and colloquialisms far better than frozen IPADIC ([`WorksApplications/Sudachi` GitHub][sudachi-gh]).
- Crucially, **rule-based Japanese deinflection** (the suffix-unwrapping state machine used by JMDict tools like Yomitan/Ichiran) works on **out-of-vocabulary neologisms and `Ask Kotori` `Drafted entry` words immediately** without recompiling a morphological binary dictionary, and composes directly with rōmaji→kana conversion.

### 3.2 English Inflections & Phrasal Verbs: Snowball/Porter vs. Morphological Lemmatization

We verified PostgreSQL's built-in English Snowball stemmer empirically in `@electric-sql/pglite` (Postgres WASM) and against official Snowball/Lucene documentation:

```sql
SELECT to_tsvector('english', 'ran mice went running');
-- Actual output: 'mice':2 'ran':1 'run':4 'went':3
```

- **Why Snowball, Porter, and `lucene.english` fail**: Snowball (Porter2) and Lucene's `PorterStemFilter` / `EnglishMinimalStemFilter` are heuristic suffix-strippers ([Snowball English Spec][snowball-en]; [Atlas Search `lucene.english` Docs][atlas-analyzers]). They strip `-ing`, `-ed`, and `-s` (`running` → `run`), but leave vowel-alternating and suppletive irregulars untouched (`ran` ≠ `run`, `went` ≠ `go`, `mice` ≠ `mouse`, `taught` ≠ `teach`, `better`/`best` ≠ `good`).
- **Why database-side synonym files fail on managed cloud Postgres**: PostgreSQL's `CREATE TEXT SEARCH DICTIONARY ... (TEMPLATE = synonym)` and `ispell` require placing physical `.syn`/`.dict` files into `$SHAREDIR/tsearch_data/` on the database host filesystem — which is **inaccessible on Neon, Supabase, and Amazon RDS** ([PostgreSQL Synonym Docs][pg-synonym]; [Neon Extensions][neon-ext]).
- **Phrasal verbs & idioms (`ran into` → `run into`, `"skating on thin ice"` → `"skate on thin ice"`)**: Even Lucene `KStemFilter` or `HunspellStemFilter` operates token-by-token and strips stop words (`into`, `on`, `in`, `up`, `off`) in standard analyzers! Dropping stop words destroys English phrasal verbs (`run into`, `put up with`, `call off` all collapse to `run`, `put`, `call`).
- **First-Principles Solution**:
  1. **Never strip English stop words on `Form` indexes** (index `Form`s with a stopword-preserving config such as Postgres `'simple'` or whitespace/keyword+lowercase analyzer so `into`, `up`, `off`, `on` survive intact).
  2. **Lemmatize in TypeScript at query time (and optionally expand irregular `Form`s at index time)** using a compact WordNet/morphological exception map (~4,500 irregular English verb/noun/adjective forms, <150 KB in memory) + regular inflection rules. Given `"ran into"`, the query normalizer emits both exact `"ran into"` and lemmatized `"run into"`, matching the phrasal verb `Entry` deterministically in **every** backend store.

### 3.3 CJK Substring & 1–2 Character Edge Cases (`pg_trgm` & `FTS5 trigram`)

A subtle production trap affects **both** PostgreSQL `pg_trgm` and SQLite `FTS5` `trigram`:
- **SQLite `FTS5` `tokenize='trigram'`**: Splits strings into contiguous 3-character slices without word-boundary padding. Any substring query of **1 or 2 characters** (e.g., `食`, `猫`, `日本`, `忖度`) has **zero 3-character trigrams** and cannot use the FTS5 trigram index, falling back to a full table scan ([SQLite FTS5 Trigram Docs][sqlite-fts5]).
- **PostgreSQL `pg_trgm`**: Under `C.UTF-8` (verified empirically in PGlite: `datctype = 'C.UTF-8'`), `pg_trgm` hashes multi-byte UTF-8 trigrams and pads **word boundaries** with two leading spaces and one trailing space (`"  日本 "` → 3 padded trigrams). Therefore:
  - **Prefix queries** (`LIKE '日本%'` or `LIKE '食%'`) **DO** use the GIN `pg_trgm` index (via `"  日"` and `" 日本"`).
  - **3+ character interior substrings** (`LIKE '%食べる%'` or `LIKE '%既読スルー%'`) **DO** use the GIN `pg_trgm` index.
  - **1–2 character unanchored interior substrings inside unspaced Japanese sentences** (e.g. `LIKE '%日本%'` inside `"この日本語の本"`) have **zero unpadded trigrams** and cannot be accelerated by `pg_trgm` alone ([PostgreSQL `pg_trgm` Docs][pg-trgm]).
- **Zero-Extension Fix**: Extracting overlapping **character bigrams + kanji unigrams** (or morphological base tokens) from Japanese `Form`s and `Gloss`es in TypeScript when writing the derived search column and indexing them in a standard GIN index (`tsvector` with `'simple'` or `text[]`) gives $O(1)$ inverted-index lookup for 1- and 2-character Japanese queries alongside `pg_trgm`.

---

## 4. Candidate Architecture Evaluations (Verified Against Primary Docs)

### 4.1 MongoDB (Self-Hosted Community vs. MongoDB Atlas)

#### Official Capabilities & Architecture
- **Data Model**: `Entry` is stored natively as a single BSON document (16 MB max per document — ample for any `Entry` + `Enrichment` + embeddings), with multi-document ACID transactions available for `Notebook` and `Ask Kotori` writes ([MongoDB Transactions][mongo-txn]).
- **MongoDB Community Edition Limitation**: Classic self-hosted MongoDB Community's built-in `$text` index **does not support Japanese (`ja`) or CJK morphological analysis** and lacks native vector/hybrid search ([MongoDB Text Search Languages][mongo-text-lang]). Full Lucene search (`$search`) and vector search (`$vectorSearch`) depend on MongoDB's separate Java/JVM `mongot` search daemon, historically exclusive to **MongoDB Atlas** (recently previewed for self-managed deployments via pairing `mongod` with a separate `mongot` JVM process) ([Atlas Search Overview][atlas-search]).
- **MongoDB Atlas Search & Vector Search**:
  - **Japanese**: Built-in `lucene.japanese` analyzer (Apache Lucene Kuromoji: `JapaneseTokenizer` + `JapaneseBaseFormFilter` + `JapanesePartOfSpeechStopFilter` + `CJKWidthFilter` + `JapaneseKatakanaStemFilter`) and custom analyzer pipelines (`kuromojiTokenizer`, `icuNormalize`, `ngram`, `edgeGram` for autocomplete) ([Atlas Search Analyzers][atlas-analyzers]).
  - **English**: `lucene.english` uses algorithmic Porter stemming (misses `ran` → `run`, `mice` → `mouse` unless explicit `synonym` collections or app-layer query expansion are configured) ([Atlas Search `lucene.english`][atlas-analyzers]).
  - **Hybrid Search & Custom Ranking**: Rich continuous scoring expressions inside `$search` (`score: { function: { add / multiply / path / gauss } }`) to weight exact `Form` > `Frequency` > sense rank while penalizing archaic/unreviewed entries, combined with `$vectorSearch` (Lucene HNSW, supporting `float32`, `int8` scalar, and `binary` quantization) via native **`$rankFusion`** (RRF) or **`$scoreFusion`** stages ([Atlas `$rankFusion`][atlas-rankfusion]; [Atlas Vector Quantization][atlas-quant]).

#### Hosting Cost & Local Dev / Automated Test Story
- **Pricing**: Atlas **M0 Free Tier** caps storage at **512 MB** and restricts search index count/memory — 350k `Entry` documents (~300 MB) + Lucene inverted indexes + 350k HNSW vectors exceed M0 limits. Production requires at least **M10 dedicated** (**~$58–$65/mo** baseline, or higher if vector HNSW RAM forces M20/dedicated search nodes, since `mongot` requires the HNSW graph to fit in RAM) ([MongoDB Pricing][mongo-pricing]; [Atlas Vector Memory Sizing][atlas-sizing]).
- **Local Dev & `pnpm test`**: Official local parity uses the **`mongodb/mongodb-atlas-local`** Docker image (`mongod` single-node replica set + JVM `mongot` coordinator inside one container) ([Atlas Local Docker Docs][atlas-local]).
  - **Friction**: Requires Docker running locally and in CI, consumes **several GB of RAM** for `mongod` + JVM `mongot` ([Atlas Sizing][atlas-sizing]), has multi-second container + index readiness latency (`createSearchIndex` is asynchronous!), and cannot run in-process inside Vitest the way PGlite or SQLite does.

---

### 4.2 PostgreSQL as a Document + Hybrid Search Store

Instead of normalizing `Entry` into 6+ relational tables, PostgreSQL stores each `Entry` as a **single row with `data jsonb`** (canonical source of truth for `Form`s, `Sense`s, `Gloss`es, `Usage`, `Caution`s, `Enrichment`, audio metadata) alongside scalar filter columns (`id`, `language`, `review_state`, `frequency_score`) and derived search columns/indexes. Adding or changing `Enrichment` JSON fields requires **zero `ALTER TABLE` migrations**.

We compare the three PostgreSQL search stacks against primary provider & extension docs:

#### Variant 4.2A: Standard Postgres (`jsonb` + `tsvector` + CJK Bigrams + `pg_trgm` + `pgvector`)
- **Extensions**: Core `tsvector`/`GIN` + standard contrib `pg_trgm`, `fuzzystrmatch`, `unaccent` + `pgvector` (`vector` v0.7/v0.8+).
- **Managed Availability**: **Universally supported** on **Neon** (`pgvector` 0.8+, `pg_trgm` built-in), **Supabase**, **Railway** (Postgres/pgvector template), Amazon RDS, and Google Cloud SQL ([Neon Supported Extensions][neon-ext]; [Supabase Extensions][supa-pgroonga]).
- **Local Dev & `pnpm test` (`PGlite`)**: `@electric-sql/pglite` natively bundles `pgvector`, `pg_trgm`, and `fuzzystrmatch` in WebAssembly with **zero Docker containers, zero external processes, and millisecond startup** ([PGlite Extensions Docs][pglite-ext]). Production SQL queries (including hybrid RRF and HNSW `<=>` cosine distance) run unmodified in `pnpm test`.
- **Hybrid & Filtered Vector Search**: `pgvector` **0.7+** adds **`halfvec`** (FP16 — cuts vector storage & HNSW RAM by **50%**, supports up to 4,000d) and `bit` binary quantization; `pgvector` **0.8.0+** adds **iterative index scans** (`SET hnsw.iterative_scan = relaxed_order`), solving the classic HNSW filtered-search drop-off when filtering by `language = 'ja'` or `review_state != 'discarded'` ([`pgvector` v0.7/v0.8 Release Docs][pgvector-gh]).
- **Custom Ranking Control**: Full SQL arithmetic — exact `Form` match, kana reading match, rōmaji match, `ts_rank_cd`, `word_similarity`, `frequency_score`, sense index, `review_state` demotion, and `halfvec` cosine distance combine in a single CTE (via weighted score fusion or Reciprocal Rank Fusion `1.0 / (60 + rank)`) with zero network hops.
- **Limitation & Mitigation**: Postgres has no built-in Japanese morphological analyzer. As established in §3, doing Japanese deinflection + tokenization and English irregular lemmatization in `@kotori/language` when populating the derived `search_tokens tsvector` column and parsing queries completely bridges this gap—and actually handles *ra-nuki*, colloquial contractions, neologisms, and irregular English phrasal verbs *better* than IPADIC + Snowball.

#### Variant 4.2B: ParadeDB (`pg_search`) + `pgvector`
- **Capabilities**: Embeds Rust **Tantivy** BM25 inside Postgres (`USING bm25`), natively indexes `jsonb` fields, and bundles **Lindera** (`pdb.lindera('japanese')`) for IPADIC Japanese segmentation ([ParadeDB GitHub][paradedb-gh]).
- **Critical Blockers (Verified)**:
  1. **License**: Licensed under **AGPL-3.0** ([ParadeDB License][paradedb-gh]).
  2. **Managed Cloud Availability**: **Removed/unavailable on Neon** ([Neon `pg_search` Docs][neon-pgsearch]) and **not supported natively on Supabase** (requires running a separate self-managed ParadeDB logical replication instance) ([Supabase ParadeDB Guide][supa-parade]). Requires ParadeDB Cloud or self-hosting the ParadeDB Docker image on Railway/VPS.
  3. **Local Tests**: Native Rust `pgrx` extension — **cannot run in WASM `PGlite`**, forcing Docker (Testcontainers) for every database test suite.

#### Variant 4.2C: `PGroonga` + `pgvector`
- **Capabilities**: Embeds Groonga inside Postgres (`USING pgroonga`), directly indexes `jsonb`, provides fast CJK prefix & substring search (`&@~`), and supports Japanese conjugation matching via `TokenMecab("use_base_form", true)` ([PGroonga Docs][pgroonga-docs]; [Groonga `TokenMecab`][groonga-mecab]).
- **Critical Blockers (Verified)**:
  1. **Managed Cloud Availability**: Supported on **Supabase** ([Supabase PGroonga Docs][supa-pgroonga]) and via template on **Railway**, **NOT supported on Neon** ([Neon Supported Extensions][neon-ext]).
  2. **Local Tests**: Native C/C++ Groonga + MeCab library — **cannot run in WASM `PGlite`**, requiring a custom Postgres+PGroonga Docker container locally and in CI.

---

### 4.3 Single-Binary Search + Document/Vector Engines (Typesense & Meilisearch)

Can Typesense or Meilisearch serve *either* as the dictionary store itself (rebuilt from Git/S3 JSONL + live mutations) *or* as a derived search sidecar alongside Postgres?

#### Using Typesense / Meilisearch as the *Primary* Dictionary Store
- **Fatal Flaw for Kotori**: Neither Typesense nor Meilisearch is an ACID relational/transactional database. `Notebook` entries, SRS review logs, users, and `Ask Kotori` `Conversation`s still require PostgreSQL. Worse, because `Ask Kotori` creates `Drafted entry` rows live (ADR 0002) and `Enrichment` workers mutate entries statefully, making a non-transactional search engine the sole source of truth risks lost writes and breaks transactional foreign-key integrity from `Notebook` cards to `Entry` IDs. Thus, they are viable **only as a derived search index** fed from canonical `Entry` JSONB rows (or canonical JSONL + Postgres).

#### Typesense (v27+)
- **Linguistic & Inflection Support**:
  - `locale: "ja"` uses ICU mixed kanji-kana segmentation (surface-level, no built-in Japanese verb lemmatization); Typesense recommends `num_typos: 0` or `1` on CJK fields to avoid RAM/noise blowups, or passing pre-tokenized text via `pre_segmented_query` ([Typesense Locales][typesense-locale]).
  - Supports **Custom Stemming Dictionaries** (`stem_dictionary`) to map English irregulars (`ran` → `run`, `mice` → `mouse`) ([Typesense Stemming][typesense-stem]).
- **Hybrid Vector Search**: Native HNSW vector fields (`float[]`) blended with keyword search via `vector_query: "embedding:([...], alpha: 0.3)"` ([Typesense Vector Search][typesense-vec]).
- **Custom Ranking Limitation**: Typesense does **not** evaluate arbitrary continuous mathematical scoring formulas per query; it sorts via tie-breaking `_text_match(buckets: N):desc, frequency_score:desc` ([Typesense Ranking & Relevance][typesense-rank]). Expressing nuanced dictionary trade-offs (e.g. exact `Form` match vs. high-frequency secondary `Sense` vs. `Gloss` match vs. `unreviewed` penalty) requires careful bucket tuning or multi-search query fan-out.
- **RAM & Pricing**: **In-memory architecture** — the entire text index + HNSW vector index must fit in RAM ($2\times\text{–}3\times$ raw text + $\sim 7\text{ B} \times d \times N$ for vectors) ([Typesense System Requirements][typesense-sysreq]). For 350k entries (~300 MB JSON) + 512d vectors ($7 \times 512 \times 350\text{k} \approx 1.25\text{ GB}$), provision **2–4 GB RAM** (~$22–$60/mo on Typesense Cloud or ~$10–$20/mo self-hosted on Railway) ([Typesense Cloud Pricing][typesense-pricing]).

#### Meilisearch (v1.10+)
- **Linguistic & Inflection Support**:
  - Uses **Charabia** (`lindera-ipadic` for Japanese) automatically without per-query locale flags, but **does not lemmatize Japanese conjugations** (`走った` ≠ `走る`) ([Meilisearch Japanese Docs][meili-ja]; [`meilisearch/charabia`][charabia-gh]).
  - Irregular inflections require uploading large `synonyms` maps (`ran` ↔ `run`).
- **Hybrid Vector Search**: Native embedder integration + `semanticRatio` (`0.0` to `1.0`) parallel merge ([Meilisearch Hybrid Search][meili-hybrid]).
- **Custom Ranking Limitation**: Strict sequential **bucket sort** (`words` → `typo` → `proximity` → `attributeRank` → `sort` → `wordPosition` → `exactness`) ([Meilisearch Ranking Rules][meili-rank]). Because earlier buckets strictly dominate later ones unless tied, blending lexical match quality continuously with word `Frequency` and sense position is notoriously rigid for dictionaries.
- **RAM & Pricing**: Backed by **LMDB** memory-mapped files on disk — runs comfortably even when RAM is $1/3$ of disk size (though indexing Lindera + vectors spikes RAM unless capped with `--max-indexing-memory`) ([Meilisearch RAM Docs][meili-ram]). Meilisearch Cloud starts at **$20–$30/mo** ([Meilisearch Pricing][meili-pricing]).

---

### 4.4 Embedded / File-Backed Hybrid Engines

Given that 350k `Entry` documents total ~250–400 MB of JSON, can the backend simply query an embedded local file or in-memory index?

| Embedded Engine | Storage & Text Search | Vector Search | Japanese / CJK Support | Operational & Concurrency Reality for Kotori Backend |
| :--- | :--- | :--- | :--- | :--- |
| **SQLite 3.45+ (`jsonb` + `FTS5` + `sqlite-vec`)** or **LibSQL (Turso)** | Binary `jsonb` blob + `FTS5` (`unicode61` / `porter` / `trigram`) ([SQLite JSONB][sqlite-jsonb]; [SQLite FTS5][sqlite-fts5]) | **`sqlite-vec`**: pure C, SIMD **brute-force KNN** + `int8`/`bit` quantized `rescore` (~15–50 ms at 350k vectors) ([`sqlite-vec`][sqlite-vec]). **LibSQL**: built-in **LM-DiskANN** (`libsql_vector_idx`) ([Turso Vector][turso-vec]) | No built-in morphological tokenizer; `trigram` misses 1–2 char queries unless app pre-tokenizes space-separated lemmas/bigrams into an `FTS5 unicode61` column | **Single-writer file lock** (`WAL` mode): works if HTTP + worker live in **one** single-instance Node process on a persistent disk volume, but breaks horizontal scaling or separate HTTP/worker containers unless using networked Turso (`libSQL`). **Ideal future fit for offline Expo mobile dictionary!** |
| **LanceDB Embedded (`@lancedb/lancedb`)** | Columnar Lance files on local disk / S3 + **Tantivy BM25 FTS** ([LanceDB FTS][lancedb-fts]) | Native Disk-backed **IVF-PQ / HNSW** + built-in RRF `.hybrid()` ([LanceDB Hybrid][lancedb-hybrid]) | Supports **`lindera/ipadic`** tokenizer in Tantivy FTS (requires staging model files in `LANCE_LANGUAGE_MODEL_HOME`) ([LanceDB Lindera][lancedb-fts]) | **Optimized for append/batch analytics, poor for frequent single-row mutations**: every live `Enrichment` update or `Drafted entry` edit writes a new MVCC fragment + deletion vector, degrading latency and leaving new rows unindexed until background `table.optimize()` + re-indexing runs ([LanceDB Compaction][lancedb-fts]). |
| **DuckDB (`fts` + `vss`)** | Columnar `.duckdb` file + Snowball BM25 `fts` | Experimental **`vss`** extension (USearch in-memory HNSW) ([DuckDB VSS][duckdb-vss]) | Whitespace/Snowball FTS only; requires app-side pre-tokenization | **Strict single-process read-write lock** (other processes cannot even open read-only while a writer is attached!) ([DuckDB Concurrency][duckdb-conc]), and `vss` HNSW index persistence/updates are explicitly marked experimental. |
| **In-Process Node JS/Rust (`Orama` / `Tantivy` napi)** | In-memory JS objects (`Orama`) or mmap directory (`Tantivy`) | In-memory vector search (`Orama`) | `@orama/tokenizers/japanese` (Intl.Segmenter / tiny segmenter — surface only) ([Orama Tokenizers][orama-tok]) | **Severe Node V8 Heap & Startup Cost**: deserializing 350k JSON docs + inverted indexes + 350k vectors into JS V8 heap in Orama consumes **2–4+ GB RAM per Node process** with multi-second cold boot, and mutations in the `Enrichment` worker aren't visible to the HTTP process without rebuilding/syncing. |

---

## 5. Side-by-Side Architecture Matrix

| Evaluation Criterion | **Postgres (`jsonb` + `tsvector` + CJK Bigrams + `pg_trgm` + `pgvector` `halfvec`)** | **Postgres + ParadeDB `pg_search` / `PGroonga`** | **MongoDB Atlas (`$search` Kuromoji + `$vectorSearch`)** | **Postgres + Typesense Sidecar** | **SQLite (`jsonb` + `FTS5` + `sqlite-vec`)** | **LanceDB Embedded (`@lancedb/lancedb`)** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Zero SQL DDL on `Entry`/`Enrichment` Churn** | **Yes** (`data jsonb` holds full `Entry` + `Enrichment`) | **Yes** (`jsonb` indexed directly) | **Yes** (native BSON document) | **Yes** (`jsonb` in PG + dynamic/schemaless JSON in Typesense) | **Yes** (`jsonb` blob) | **Partial** (Arrow schema changes require table alter/migration) |
| **Infrastructure Moving Parts** | **1** (single Postgres DB for everything) | **1** (custom Postgres host/Docker) | **1 vendor** (Atlas cloud; or PG + Atlas = 2) | **2** (Postgres + Typesense + sync worker) | **2** (if PG kept for users/auth) or **1** (single-node SQLite) | **2** (Postgres for users/`Notebook` + LanceDB files) |
| **Managed Hosting Portability** | **Universal** (Neon, Supabase, Railway, RDS, self-hosted) | **Restricted** (`pg_search` AGPL & dropped from Neon; `PGroonga` on Supabase/Railway, not Neon) | **Locked to MongoDB Atlas** | **High** (Typesense Cloud or self-hosted Docker anywhere) | **Single-node volume** (or Turso `libSQL` cloud) | **Object storage / local disk** (or LanceDB Cloud) |
| **Local Dev & Zero-Docker `pnpm test`** | **Effortless** (in-process WASM `PGlite` runs identical SQL + `vector` + `pg_trgm`) | **Requires Docker** (not in `PGlite`) | **Heavy Docker** (`mongodb-atlas-local` JVM `mongot`) | **Requires binary/Docker** or test double | **Effortless** (in-memory SQLite) | **Effortless** (embedded N-API binary, temp dir) |
| **Japanese Inflection Resilience** | **Excellent via `@kotori/language`** (rule deinflector + optional Sudachi/Lindera tokens indexed in `tsvector`) | **Good built-in** (IPADIC MeCab/Lindera; weak on slang/*ra-nuki* without app layer) | **Good built-in** (IPADIC Kuromoji; weak on slang/*ra-nuki* without app layer) | **Requires app layer** (`locale: "ja"` is surface-only) | **Requires app layer** (pre-tokenized `FTS5`) | **Partial** (`lindera/ipadic` surface segmentation) |
| **English Irregulars & Phrasal Verbs** | **Excellent via `@kotori/language`** (lemmatized tokens + stopword-preserving `'simple'` `tsvector`) | **Requires app layer** (Snowball misses `ran`/`mice`) | **Requires custom synonym map or app layer** | **Good** (`stem_dictionary` API + app layer) | **Requires app layer** (`porter` misses `ran`/`mice`) | **Requires app layer** |
| **Prefix, Typo & 1–2 Char CJK Substring** | **Strong** (`B-tree`/`text_pattern_ops` prefix + `pg_trgm` fuzzy + derived CJK bigrams/unigrams GIN) | **Excellent** (especially `PGroonga` native prefix/substring) | **Excellent** (`edgeGram` + `fuzzy` + `cjk` bigrams) | **Best-in-class** (<10ms prefix + Damerau-Levenshtein typo tolerance) | **Good** (`FTS5` prefix `*` + `trigram` + app bigrams) | **Moderate** (Tantivy FTS + n-grams) |
| **Custom Ranking & Hybrid Vector Control** | **Full SQL expressiveness** (arbitrary math on `Frequency`, exact `Form`, sense rank, `halfvec` HNSW + RRF) | **High** (BM25 + SQL + `pgvector` RRF) | **High** (Lucene `function` scores + `$rankFusion`) | **Moderate** (discrete `_text_match(buckets: N)` tie-breaking + `alpha`) | **Moderate** (`bm25()` + scalar SQL + quantized KNN) | **Moderate** (Tantivy BM25 + ANN RRF; awkward single-row updates) |
| **Monthly Prod Cost (<10 MAU, 350k docs)** | **$0–$15/mo** | **$15–$35/mo** (Supabase Pro / Railway) | **~$58+/mo** (Atlas M10) | **~$22–$40/mo** | **$5–$10/mo** | **$5–$15/mo** |

---

## 6. Cross-Lingual EN ↔ JP Embedding Model Selection

For dictionary conceptual lookup (e.g., querying *"annoyed when someone leaves you on read"* and surfacing `既読スルー`, or finding cross-lingual near-synonyms), the embedding model must align English descriptions and Japanese expressions in the same semantic vector space.

| Model | Dimensions (Matryoshka?) | Pricing (per 1M tokens) | One-Time Cost to Embed 350k Entries (~50M tokens) | Cross-Lingual EN↔JP Quality & Trade-offs |
| :--- | :--- | :--- | :--- | :--- |
| **Voyage `voyage-3` / `voyage-3.5` / `voyage-multilingual-2`** | `1024` default; `voyage-3-large` / `3.5` truncate cleanly to **`512` or `1024`** + native `int8`/`binary` output ([Voyage Docs][voyage-emb]) | **$0.06–$0.12** (**first 50M–200M tokens free**) | **$0.00** (covered by free tier; ~$3–$6 thereafter) | **Top-tier multilingual & JP↔EN retrieval precision**; purpose-built for asymmetric query→document retrieval (`input_type: "query"` vs `"document"`). |
| **OpenAI `text-embedding-3-large` (truncated to `512` or `1024`d)** | `3072` native → **`512` or `1024` via MRL `dimensions`** ([OpenAI Docs][openai-emb3]) | **$0.13** ($0.065 Batch API) | **~$3.25** (Batch API) | **54.9% MIRACL multilingual score** (vs. **44.0%** for `text-embedding-3-small` and 31.4% for `ada-002`) ([OpenAI Announcement][openai-miracl]). Vastly stronger JP↔EN alignment than `3-small` while costing ~$3 total via Batch API and occupying the exact same DB RAM when truncated to `512d`/`1024d`! |
| **OpenAI `text-embedding-3-small`** | `1536` native → **`512`** via MRL | **$0.02** ($0.01 Batch API) | **~$0.50** (Batch API) | Cheapest API option, **44.0% MIRACL** — noticeably weaker than `3-large` and `voyage` on idiomatic cross-lingual Japanese nuances. |
| **Cohere `embed-multilingual-v3.0` / `embed-v4.0`** | `1024` (`v3`) / `256–1536` (`v4`) | **$0.10–$0.12** | **~$5.00–$6.00** | Strong multilingual alignment with `search_query` / `search_document` input types. |
| **Open-Weight (`BAAI/bge-m3`, `intfloat/multilingual-e5-large`)** | `1024` | Self-hosted / inference API (~$0.01–$0.03) | ~$0–$1.50 | Excellent JP↔EN benchmark scores (`BGE-M3` MIT license), but running a ~2.2 GB PyTorch/ONNX model inside Kotori's backend violates the "minimal moving parts" constraint unless called via a serverless API. |

> **Embedding Recommendation**: Use **OpenAI `text-embedding-3-large` with `dimensions: 512` (or `1024`)** or **Voyage `voyage-3.5` (`512` / `1024`d)** stored in Postgres as **`halfvec(512)`** (~358 MB total for 350k entries). Embed a **bilingual composite text template per `Entry`** (`"<Forms in kanji/kana/en> — <Primary Senses & Glosses in EN & JP> — <Usage & summary>"`) so both monolingual and cross-lingual semantic queries land directly in the same neighborhood, and execute query-time embedding **only** when lexical/prefix results have low confidence or on explicit semantic/concept searches to keep typeahead latency <15 ms.

---

## 7. Concrete Blueprint for the Recommended Architecture

### Why Single-Store PostgreSQL Document (`jsonb`) + Derived Search Projection Wins

1. **Zero DDL Churn on `Entry` & `Enrichment`**:
   ```sql
   CREATE TABLE entries (
     id               uuid PRIMARY KEY,
     language         text NOT NULL,             -- 'ja' | 'en'
     review_state     text NOT NULL,             -- 'approved' | 'unreviewed' | 'discarded'
     frequency_score  real NOT NULL DEFAULT 0,   -- normalized [0, 1] signal for ranking
     data             jsonb NOT NULL,            -- Canonical Entry + Forms + Senses + Glosses + Usage + Cautions + Enrichment!
     -- Derived, rebuildable search projection columns (populated by deterministic TS function on write):
     exact_forms      text[] NOT NULL,           -- normalized surface & reading forms (kanji, hiragana, en lowercase)
     prefix_forms     text NOT NULL,             -- space-joined forms + romaji for pg_trgm fuzzy & prefix matching
     search_tsv       tsvector NOT NULL,         -- weighted ('A' forms/lemmas, 'B' primary glosses + CJK bigrams, 'C' secondary/usage)
     embedding        halfvec(512),              -- optional cross-lingual semantic vector (pgvector 0.7+)
     updated_at       timestamptz NOT NULL DEFAULT now()
   );

   CREATE INDEX entries_exact_forms_gin  ON entries USING gin (exact_forms);
   CREATE INDEX entries_prefix_trgm_gin  ON entries USING gin (prefix_forms gin_trgm_ops);
   CREATE INDEX entries_search_tsv_gin   ON entries USING gin (search_tsv);
   CREATE INDEX entries_embedding_hnsw   ON entries USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);
   ```
   - When AI `Enrichment` adds new fields (e.g. speaker demographic tags, pitch-accent contours, new `Caution` subtypes, audio voice clips), **zero SQL migrations run**: only the TypeScript Effect `Schema` for `EntryData` changes.
   - If the search projection logic ever changes, a single idempotent batch command re-projects `exact_forms`, `prefix_forms`, and `search_tsv` purely from `data`.

2. **Deterministic Linguistic Pipeline in `@kotori/language` (Zero Engine Black Boxes)**:
   - **On `Entry` write/upsert** (~0.2 ms per `Entry`):
     - Weight `'A'`: all `Form`s (kanji, normalized hiragana, katakana→hiragana, rōmaji, lowercase English, plus lemmatized English base words via `'simple'` `tsvector` so phrasal particles like `into`/`up`/`off` are preserved).
     - Weight `'B'`: primary `Gloss`es + lemmatized English words + Japanese deinflected base tokens + overlapping CJK character bigrams/kanji unigrams (solving 1–2 char CJK substring lookups without `PGroonga`).
     - Weight `'C'`: `Usage` summary and `Caution` keywords.
   - **On Query**:
     - Normalize script (NFKC, katakana→hiragana, rōmaji→hiragana candidate), run **rule-based Japanese deinflection** (`食べさせられた` → `食べる`, `食べちゃった` → `食べる`, `高くない` → `高い`, `見れる` → `見る`) and **English morphological lemmatization** (`ran into` → `run into`, `mice` → `mouse`).
     - Run fast lexical candidate retrieval (`exact_forms && $forms OR search_tsv @@ $tsquery OR prefix_forms %> $query`) + optional HNSW semantic retrieval (`ORDER BY embedding <=> $qvec LIMIT 30` with `hnsw.iterative_scan = relaxed_order`), fused and ranked in SQL by:
       1. Exact primary/secondary `Form` match (`exact_forms`)
       2. Inflected-lemma `Form` match
       3. `Frequency` score & `Sense` position (1st sense > 4th sense)
       4. Exact phrase / token `Gloss` match (`ts_rank_cd`)
       5. RRF semantic vector similarity boost
       6. Explicit multiplicative penalties for `archaic`/`rare` usage tags and `review_state = 'unreviewed'` (`Drafted entry`), while filtering out `review_state = 'discarded'`.

3. **Clean Escape Hatch to Contender #2 (Typesense)**:
   - Because `Entry` already lives as a self-contained JSON document (`data jsonb`) behind a clean repository/search Effect service interface in `@kotori/backend`, adding a derived **Typesense** index later (if MAU grows to tens of thousands and sub-10ms keystroke autocomplete needs offloading from Postgres) requires **zero data model changes** — just streaming `entries.data` + ` language` + `frequency_score` into Typesense.

---

## 8. Primary References

1. **Apache Lucene (`kuromoji` Japanese Analysis)**:
   - [Package `org.apache.lucene.analysis.ja` Official Javadocs][lucene-ja]
   - [`JapaneseBaseFormFilter` Official Javadocs][lucene-baseform]
   - [`EnglishAnalyzer` Official Javadocs][lucene-en]
2. **Sudachi & Japanese Tokenization**:
   - [WorksApplications / Sudachi GitHub Repository & Multi-Granular Spec][sudachi-gh]
3. **Snowball & PostgreSQL Full-Text / Trigram / Vector Search**:
   - [Snowball Porter2 English Stemming Algorithm Specification][snowball-en]
   - [PostgreSQL Official Docs — Text Search Dictionaries (`synonym`, `ispell`, `snowball`)][pg-fts-dict]
   - [PostgreSQL Official Docs — Synonym Dictionary (`$SHAREDIR/tsearch_data`)][pg-synonym]
   - [PostgreSQL Official Docs — `pg_trgm` Trigram Matching & Padding Rules][pg-trgm]
   - [`pgvector/pgvector` Official GitHub (`halfvec` FP16, HNSW Memory, v0.8 Iterative Index Scans)][pgvector-gh]
4. **Managed PostgreSQL Extensions, ParadeDB, PGroonga & PGlite**:
   - [Neon Official Docs — Supported Postgres Extensions][neon-ext]
   - [Neon Official Docs — `pg_search` Retirement / Availability][neon-pgsearch]
   - [ParadeDB `paradedb/paradedb` Official GitHub (`pg_search`, Lindera, AGPL-3.0 License)][paradedb-gh]
   - [Supabase Official Docs — `PGroonga` Extension][supa-pgroonga]
   - [Supabase Official Docs — ParadeDB Logical Replication Architecture][supa-parade]
   - [PGroonga Official Reference Manual][pgroonga-docs] & [PGroonga Tokenizers][pgroonga-tok]
   - [Groonga Official Docs — `TokenMecab` (`use_base_form`)][groonga-mecab]
   - [ElectricSQL PGlite Official Docs — Extensions & Contrib (`vector`, `pg_trgm`, `fuzzystrmatch`)][pglite-ext]
5. **MongoDB & MongoDB Atlas Search**:
   - [MongoDB Manual — Text Search Languages in Self-Managed / Community][mongo-text-lang]
   - [MongoDB Manual — Multi-Document ACID Transactions][mongo-txn]
   - [MongoDB Atlas Search Overview][atlas-search] & [Built-in Language Analyzers (`lucene.japanese`, `lucene.english`)][atlas-analyzers]
   - [MongoDB Atlas Hybrid Search with `$rankFusion`][atlas-rankfusion]
   - [MongoDB Atlas Vector Quantization][atlas-quant] & [Vector Search Memory Sizing (`mongot`)][atlas-sizing]
   - [MongoDB Local Atlas Deployment with Docker (`mongodb/mongodb-atlas-local`)][atlas-local]
   - [MongoDB Cloud Pricing (M0 vs. M10+)][mongo-pricing]
6. **Typesense & Meilisearch**:
   - [Typesense Official Docs — Multilingual Search & Locales (`ja`)][typesense-locale]
   - [Typesense Official Docs — Stemming & Custom Stemming Dictionaries][typesense-stem]
   - [Typesense Official Docs — Vector & Hybrid Search][typesense-vec]
   - [Typesense Official Docs — Ranking and Relevance (`_text_match` Buckets)][typesense-rank]
   - [Typesense Official Docs — System & RAM Requirements][typesense-sysreq] & [Typesense Cloud Pricing][typesense-pricing]
   - [Meilisearch Official Docs — Japanese & CJK Tokenization][meili-ja]
   - [`meilisearch/charabia` Official GitHub][charabia-gh], [Charabia Issue #131][charabia-131], & [Meilisearch Discussion #532][meili-532]
   - [Meilisearch Official Docs — Ranking Rules][meili-rank], [Hybrid Search][meili-hybrid], [RAM / LMDB Sizing][meili-ram], & [Meilisearch Pricing][meili-pricing]
7. **Embedded Engines (SQLite, LibSQL, LanceDB, DuckDB, Orama)**:
   - [SQLite Official Docs — JSONB Binary Format (3.45+)][sqlite-jsonb] & [SQLite FTS5 Extension (`unicode61`, `porter`, `trigram`)][sqlite-fts5]
   - [`asg017/sqlite-vec` Official GitHub (Brute-Force KNN, Quantized Rescore, ANN Roadmap)][sqlite-vec]
   - [Turso / LibSQL Official Docs — Native AI & LM-DiskANN Vector Search][turso-vec]
   - [LanceDB Official Docs — Full-Text Search & Lindera Tokenizers][lancedb-fts] & [Hybrid Search][lancedb-hybrid]
   - [DuckDB Official Docs — `vss` HNSW Extension][duckdb-vss] & [Concurrency Model][duckdb-conc]
   - [Orama Official Docs — CJK / Japanese Tokenizers][orama-tok]
8. **Multilingual Embedding Models**:
   - [OpenAI — New Embedding Models & MIRACL Benchmark (`text-embedding-3-small` 44.0% vs `text-embedding-3-large` 54.9%)][openai-miracl]
   - [OpenAI Platform Docs — Vector Embeddings & Matryoshka `dimensions`][openai-emb3]
   - [Voyage AI Official Docs — Text Embeddings, Dimensions & Quantization (`voyage-3`, `voyage-multilingual-2`)][voyage-emb]

[lucene-ja]: https://lucene.apache.org/core/9_11_0/analysis/kuromoji/org/apache/lucene/analysis/ja/package-summary.html
[lucene-baseform]: https://lucene.apache.org/core/9_11_0/analysis/kuromoji/org/apache/lucene/analysis/ja/JapaneseBaseFormFilter.html
[lucene-en]: https://lucene.apache.org/core/9_11_0/analysis/common/org/apache/lucene/analysis/en/EnglishAnalyzer.html
[sudachi-gh]: https://github.com/WorksApplications/Sudachi
[snowball-en]: https://snowballstem.org/algorithms/english/stemmer.html
[pg-fts-dict]: https://www.postgresql.org/docs/current/textsearch-dictionaries.html
[pg-synonym]: https://www.postgresql.org/docs/current/textsearch-dictionaries.html#TEXTSEARCH-SYNONYM-DICTIONARY
[pg-trgm]: https://www.postgresql.org/docs/current/pgtrgm.html
[pgvector-gh]: https://github.com/pgvector/pgvector
[neon-ext]: https://neon.tech/docs/extensions/pg-extensions
[neon-pgsearch]: https://neon.tech/docs/extensions/pg_search
[paradedb-gh]: https://github.com/paradedb/paradedb
[supa-pgroonga]: https://supabase.com/docs/guides/database/extensions/pgroonga
[supa-parade]: https://supabase.com/docs/guides/ai/hybrid-search
[pgroonga-docs]: https://pgroonga.github.io/
[pgroonga-tok]: https://pgroonga.github.io/reference/create-index-using-pgroonga.html
[groonga-mecab]: https://groonga.org/docs/reference/tokenizers/token_mecab.html
[pglite-ext]: https://pglite.dev/extensions/
[mongo-text-lang]: https://www.mongodb.com/docs/manual/reference/text-search-languages/
[mongo-txn]: https://www.mongodb.com/docs/manual/core/transactions/
[atlas-search]: https://www.mongodb.com/docs/atlas/atlas-search/
[atlas-analyzers]: https://www.mongodb.com/docs/atlas/atlas-search/analyzers/language/
[atlas-rankfusion]: https://www.mongodb.com/docs/atlas/atlas-vector-search/hybrid-search/vector-search-with-full-text-search/
[atlas-quant]: https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-quantization/
[atlas-sizing]: https://www.mongodb.com/docs/atlas/atlas-vector-search/tune-vector-search/
[atlas-local]: https://www.mongodb.com/docs/atlas/cli/current/atlas-cli-deploy-docker/
[mongo-pricing]: https://www.mongodb.com/pricing
[typesense-locale]: https://typesense.org/docs/guide/multilingual-search.html
[typesense-stem]: https://typesense.org/docs/27.1/api/stemming.html
[typesense-vec]: https://typesense.org/docs/27.1/api/vector-search.html
[typesense-rank]: https://typesense.org/docs/guide/ranking-and-relevance.html
[typesense-sysreq]: https://typesense.org/docs/guide/system-requirements.html
[typesense-pricing]: https://cloud.typesense.org/pricing
[meili-ja]: https://www.meilisearch.com/docs/learn/Indexing_and_search/japanese
[charabia-gh]: https://github.com/meilisearch/charabia
[charabia-131]: https://github.com/meilisearch/charabia/issues/131
[meili-532]: https://github.com/meilisearch/meilisearch/discussions/532
[meili-rank]: https://www.meilisearch.com/docs/learn/relevancy/ranking_rules
[meili-hybrid]: https://www.meilisearch.com/docs/learn/ai_powered_search/getting_started_with_ai_search
[meili-ram]: https://www.meilisearch.com/docs/learn/self_hosting/memory_usage
[meili-pricing]: https://www.meilisearch.com/pricing
[sqlite-jsonb]: https://www.sqlite.org/json1.html#jsonb
[sqlite-fts5]: https://www.sqlite.org/fts5.html
[sqlite-vec]: https://github.com/asg017/sqlite-vec
[turso-vec]: https://docs.turso.tech/features/ai-and-embeddings
[lancedb-fts]: https://lancedb.github.io/lancedb/fts/
[lancedb-hybrid]: https://lancedb.github.io/lancedb/hybrid_search/hybrid_search/
[duckdb-vss]: https://duckdb.org/docs/extensions/vss.html
[duckdb-conc]: https://duckdb.org/docs/connect/concurrency.html
[orama-tok]: https://docs.orama.com/open-source/text-analysis/tokenizers
[openai-miracl]: https://openai.com/index/new-embedding-models-and-api-updates/
[openai-emb3]: https://platform.openai.com/docs/guides/embeddings
[voyage-emb]: https://docs.voyageai.com/docs/embeddings
