/**
 * photo-reaper — deletes leak-decline photos past their retention date
 * (photo_retention_days config, stamped as photos.delete_after at upload).
 * Privacy is zero-touch too.
 */
import { handle, json, serviceClient } from "../_shared/env.ts";

Deno.serve(
  handle(async (_req) => {
    const svc = serviceClient();
    const today = new Date().toISOString().slice(0, 10);

    const { data: expired, error } = await svc
      .from("photos")
      .select("id, storage_path")
      .lte("delete_after", today)
      .limit(200);
    if (error) return json({ error: error.message }, 500);

    let deleted = 0;
    for (const photo of (expired ?? []) as { id: string; storage_path: string }[]) {
      const { error: rmErr } = await svc.storage.from("leak-photos").remove([photo.storage_path]);
      // missing object is fine — the row is the source of truth for retention
      if (rmErr && !/not.*found/i.test(rmErr.message)) {
        console.error(`storage remove failed for ${photo.id}: ${rmErr.message}`);
        continue;
      }
      await svc.from("photos").delete().eq("id", photo.id);
      deleted++;
    }
    return json({ deleted });
  }),
);
