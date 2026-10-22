import { Effect, Exit, Scope } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import type { Connection } from "effect/sql/SqlConnection"
import {
  CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
  type TransactionSettings
} from "kysely"

/**
 * A Kysely dialect that runs Better Auth's queries on Kotori's own `SqlClient`:
 * one `DATABASE_URL`, one connection pool, and PGlite in tests. Kysely compiles
 * Postgres SQL; this only moves the statements and rows across.
 */
export class SqlClientDialect implements Dialect {
  constructor(private readonly sql: SqlClient) {}

  createDriver(): Driver {
    return new SqlClientDriver(this.sql)
  }

  createQueryCompiler() {
    return new PostgresQueryCompiler()
  }

  createAdapter() {
    return new PostgresAdapter()
  }

  createIntrospector(db: Kysely<unknown>) {
    return new PostgresIntrospector(db)
  }
}

class SqlClientDriver implements Driver {
  constructor(private readonly sql: SqlClient) {}

  async init() {}

  /** Reserves a connection until `releaseConnection`, so a transaction stays on one session. */
  async acquireConnection(): Promise<DatabaseConnection> {
    const scope = Scope.makeUnsafe()
    const connection = await Effect.runPromise(Scope.provide(this.sql.reserve, scope))
    return new SqlClientConnection(connection, scope)
  }

  async beginTransaction(connection: DatabaseConnection, settings: TransactionSettings) {
    const clauses = [
      settings.isolationLevel === undefined ? [] : [`isolation level ${settings.isolationLevel}`],
      settings.accessMode === undefined ? [] : [settings.accessMode]
    ].flat()
    await connection.executeQuery(
      CompiledQuery.raw(clauses.length === 0 ? "begin" : `start transaction ${clauses.join(" ")}`)
    )
  }

  async commitTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(CompiledQuery.raw("commit"))
  }

  async rollbackTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(CompiledQuery.raw("rollback"))
  }

  async releaseConnection(connection: DatabaseConnection) {
    await (connection as SqlClientConnection).release()
  }

  /** The pool belongs to the Effect layer that created it. */
  async destroy() {}
}

/** What the Postgres clients hand back from a raw statement, in either flavour. */
interface RawResult {
  readonly rows?: ReadonlyArray<unknown> | undefined
  readonly rowCount?: number | undefined
  readonly affectedRows?: number | undefined
}

class SqlClientConnection implements DatabaseConnection {
  constructor(
    private readonly connection: Connection,
    private readonly scope: Scope.Closeable
  ) {}

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const result = (await Effect.runPromise(this.connection.executeRaw(query.sql, query.parameters))) as RawResult
    return {
      rows: [...(result.rows ?? [])] as Array<R>,
      numAffectedRows: BigInt(result.affectedRows ?? result.rowCount ?? 0)
    }
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("SqlClientDialect does not stream results")
  }

  release() {
    return Effect.runPromise(Scope.close(this.scope, Exit.void))
  }
}
