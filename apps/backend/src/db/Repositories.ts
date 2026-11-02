import { Layer } from "effect"
import { UsersRepo } from "../features/accounts/UsersRepo.ts"
import { CoachRepo } from "../features/coaching/CoachRepo.ts"
import { DictionaryRepo } from "../features/dictionary/DictionaryRepo.ts"
import { EnrichmentRepo } from "../features/enrichment/EnrichmentRepo.ts"
import { JobsRepo } from "../features/enrichment/JobsRepo.ts"
import { StudyRepo } from "../features/study/StudyRepo.ts"

/** Every repository; requires `Database` (see `DatabaseLive` / `DatabaseMemory`). */
export const Repositories = Layer.mergeAll(
  DictionaryRepo.layer,
  EnrichmentRepo.layer,
  JobsRepo.layer,
  UsersRepo.layer,
  StudyRepo.layer,
  CoachRepo.layer
)
