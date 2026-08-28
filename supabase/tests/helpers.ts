import pg from "pg";

/**
 * DB test harness. Each RPC call runs in its own transaction with
 * `set local role authenticated` + the caller's JWT-sub GUC — exactly the
 * execution context PostgREST gives RPCs, including RLS enforcement.
 * Works against both plain Postgres (CI shim) and a local Supabase stack
 * (TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres).
 */

const connectionString =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/pinui_test";

export const pool = new pg.Pool({ connectionString, max: 10 });

let phoneCounter = 0;

/** Create an auth user (shim/GoTrue table); the on-insert trigger provisions public.users. */
export async function createTestUser(prefix = "97250"): Promise<{ id: string; phone: string }> {
  phoneCounter += 1;
  const phone = `${prefix}${String(Date.now() % 1_000_000_000)}${phoneCounter}`;
  // Real GoTrue's auth.users.id has no default (ids are generated app-side),
  // so supply one explicitly; works identically on the CI shim.
  const { rows } = await pool.query(
    "insert into auth.users (id, phone) values (gen_random_uuid(), $1) returning id, phone",
    [phone],
  );
  return rows[0] as { id: string; phone: string };
}

export async function makeAdmin(userId: string): Promise<void> {
  await pool.query(
    "insert into public.admin_users (user_id, role) values ($1, 'owner') on conflict do nothing",
    [userId],
  );
}

export interface CallOptions {
  /** run as this role; default 'authenticated' */
  role?: "authenticated" | "anon" | "service_role";
}

/**
 * Run `sql` as the given user in a single committed transaction.
 * Returns rows; throws with the RPC's stable error code in error.message.
 */
export async function callAs<T = Record<string, unknown>>(
  userId: string | null,
  sql: string,
  params: unknown[] = [],
  opts: CallOptions = {},
): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${opts.role ?? "authenticated"}`);
    if (userId) {
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    }
    const res = await client.query(sql, params);
    await client.query("commit");
    return res.rows as T[];
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** service-role / superuser query (bypasses RLS) for seeding + assertions. */
export async function serviceQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

/** Assert an RPC failed with a stable error code. */
export async function expectRpcError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes(code)) {
      throw new Error(`expected error code "${code}", got: ${msg}`);
    }
    return;
  }
  throw new Error(`expected error code "${code}" but the call succeeded`);
}
