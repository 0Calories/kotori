export * from "./CoachRepo.ts"
export * from "./Database.ts"
export * from "./DictionaryRepo.ts"
export * from "./EnrichmentRepo.ts"
export * from "./JobsRepo.ts"
export * from "./Paths.ts"
export * from "./records.ts"
export * from "./StudyRepo.ts"
export * from "./UsersRepo.ts"

import { Layer } from "effect"
import { CoachRepo } from "./CoachRepo.ts"
import { DictionaryRepo } from "./DictionaryRepo.ts"
import { EnrichmentRepo } from "./EnrichmentRepo.ts"
import { JobsRepo } from "./JobsRepo.ts"
import { StudyRepo } from "./StudyRepo.ts"
import { UsersRepo } from "./UsersRepo.ts"

/** Every repository; requires a `SqlClient` (see `DatabaseLive` / `DatabaseMemory`). */
export const Repositories = Layer.mergeAll(
  DictionaryRepo.layer,
  EnrichmentRepo.layer,
  JobsRepo.layer,
  UsersRepo.layer,
  StudyRepo.layer,
  CoachRepo.layer
)
