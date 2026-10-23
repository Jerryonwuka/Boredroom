import { z } from "zod";
import { route, orgContext, parseBody, ok } from "@/server/lib/api";
import { notFound } from "@/server/lib/errors";
import { providerFromSlug } from "@/server/connectors/registry";
import { requireConnectors, setPolicy } from "@/server/connectors/connections";

const schema = z.object({ personalAllowed: z.boolean().optional(), brendaReads: z.boolean().optional(), brendaActs: z.boolean().optional() });

/** The workspace's rules for one app (owners and HR): people may connect their own, Brenda may read, Brenda may act. */
export const PUT = route<{ org: string; provider: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  await requireConnectors(ctx);
  const provider = providerFromSlug(params.provider);
  if (!provider) throw notFound();
  return ok(await setPolicy(ctx, provider, await parseBody(req, schema, { maxBytes: 512 })));
});
