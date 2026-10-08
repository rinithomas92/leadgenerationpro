import { getChatGPTUser } from "@/app/chatgpt-auth";
import { sameOrigin } from "@/lib/server-store";
import { campaignSchema, deduplicate } from "@/lib/leadgen";
import {
  buildDirectoryQuery,
  directoryLeads,
  researchLeads,
  type DirectoryElement,
} from "@/lib/discovery";
import { z } from "zod";
export async function POST(req: Request) {
  if (!(await getChatGPTUser()))
    return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!sameOrigin(req))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const raw = await req.text();
    if (raw.length > 30000)
      return Response.json(
        { error: "Campaign is too large." },
        { status: 413 },
      );
    const parsed = z
      .object({
        campaign: campaignSchema,
        mode: z.enum(["research", "directory"]).default("directory"),
      })
      .safeParse(JSON.parse(raw));
    if (!parsed.success)
      return Response.json(
        { error: "Select a valid campaign." },
        { status: 400 },
      );
    const { campaign, mode } = parsed.data;
    const researched = researchLeads(campaign);
    if (mode === "research")
      return Response.json({
        leads: researched,
        mode: "research",
        message:
          "Business website research snapshot, checked 14 Sep 2026. Coverage: Pune hotels, interior designers and mental-wellness organisations.",
      });
    const { query } = buildDirectoryQuery(campaign);
    try {
      const response = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "LeadGenPro/1.0 (user-initiated business discovery)",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) throw new Error("Directory temporarily unavailable");
      const result = (await response.json()) as {
        elements?: DirectoryElement[];
        remark?: string;
      };
      if (!Array.isArray(result.elements) || result.remark)
        throw new Error("Directory query incomplete");
      const live = directoryLeads(campaign, result.elements);
      return Response.json({
        leads: [...researched, ...deduplicate(researched, live)],
        mode: "directory",
        message:
          "Real public listings. City-boundary search; service radius is not applied. Contact coverage varies. Directory entries may be outdated; review the source before outreach.",
      });
    } catch {
      if (researched.length)
        return Response.json({
          leads: researched,
          mode: "research",
          message:
            "Live directory is temporarily unavailable. Showing real businesses from the source-linked research snapshot checked 14 Sep 2026.",
        });
      return Response.json(
        {
          error:
            "The public directory is temporarily unavailable. No sample leads were substituted. Try again later or import a CSV.",
        },
        { status: 503 },
      );
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Discovery failed." },
      { status: 400 },
    );
  }
}
