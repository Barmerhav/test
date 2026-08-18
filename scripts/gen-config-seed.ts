/**
 * Generates supabase/seeds/01_config.sql from packages/shared/src/config/schema.ts
 * — the single source of truth. Run after adding/changing any config key:
 *
 *   pnpm gen:config-seed
 *
 * Idempotent upsert: on re-seed, `schema` and `description` are refreshed but
 * a live `value` is never clobbered (the founder's edits win).
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { CONFIG_KEYS, configEntries } from "../packages/shared/src/config/schema";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const sqlLit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
const textLit = (s: string) => `'${s.replace(/'/g, "''")}'`;

const rows = CONFIG_KEYS.map((key) => {
  const e = configEntries[key];
  const jsonSchema = zodToJsonSchema(e.schema, { $refStrategy: "none", target: "jsonSchema7" });
  // strip the $schema meta key — pg_jsonschema doesn't need it
  delete (jsonSchema as Record<string, unknown>)["$schema"];
  return `  (${textLit(key)}, ${sqlLit(e.default)}, ${sqlLit(jsonSchema)}, ${textLit(e.description)})`;
}).join(",\n");

const out = `-- GENERATED FILE — do not edit by hand.
-- Source: packages/shared/src/config/schema.ts · Regenerate: pnpm gen:config-seed

insert into public.config (key, value, schema, description) values
${rows}
on conflict (key) do update
  set schema = excluded.schema,
      description = excluded.description;
`;

const dest = join(root, "supabase", "seeds", "01_config.sql");
writeFileSync(dest, out);
console.log(`wrote ${dest} (${CONFIG_KEYS.length} keys)`);
