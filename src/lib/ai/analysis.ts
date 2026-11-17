import { z } from "zod";
import type { Creator, CreatorPost } from "@/lib/types";
import { buildEvidence, filterGrounded, renderEvidence, type Evidence } from "./evidence";

const cited = { evidence: z.array(z.string()).describe("Evidence ids like E3 that directly support this item") };

export const AnalysisSchema = z.object({
  niche: z.object({ value: z.string(), ...cited }),
  content_themes: z.array(z.object({ theme: z.string(), ...cited })),
  communication_style: z.object({ description: z.string(), ...cited }),
  audience_interests: z.array(
    z.object({
      interest: z.string(),
      confidence: z.enum(["supported", "speculative"]),
      ...cited,
    }),
  ),
  top_content: z.array(z.object({ evidence_id: z.string(), why_it_worked: z.string(), ...cited })),
  potential_problems: z.array(z.object({ problem: z.string(), reasoning: z.string(), ...cited })),
  software_ideas: z.array(z.object({ idea: z.string(), addresses: z.string(), ...cited })),
  collaboration_opportunities: z.array(z.object({ opportunity: z.string(), ...cited })),
  data_gaps: z.array(z.string()).describe("What we don't know that would change this analysis"),
});
export type AnalysisResult = z.infer<typeof AnalysisSchema>;

export const ANALYSIS_SYSTEM = `You analyse public social-media creator data for a software engineer who wants to build useful software with creators.

Hard rules:
- You may only use facts from the numbered EVIDENCE table. Cite evidence ids for every item.
- Never invent facts, numbers, products, sponsors, personal details, or audience demographics.
- If evidence is thin, return fewer items and say what is missing in data_gaps. Empty arrays are fine.
- Audience interests: mark "supported" only when captions/bio/comments counts make it evident; otherwise "speculative".
- Potential problems and software ideas are hypotheses — phrase them as such ("may", "could") and cite the evidence that prompted them.
- top_content: pick from post evidence using the view/engagement numbers given; evidence_id must be a post id.
- Be concrete and specific to this creator; avoid generic creator-economy platitudes.`;

export function buildAnalysisPrompt(c: Creator, ev: Evidence[], targetNiches: string[]): string {
  return `EVIDENCE:
${renderEvidence(ev)}

CONTEXT:
- The operator is interested in these niches: ${targetNiches.length ? targetNiches.join(", ") : "(none specified)"}.
- The operator could build: custom tools, apps, automations, dashboards, communities, booking/course/membership tooling, content workflows.

Analyse @${c.handle} on ${c.platform}.`;
}

export function groundAnalysis(r: AnalysisResult, ev: Evidence[]) {
  const dropped: { section: string; item: unknown }[] = [];
  const keep = <T extends { evidence: string[] }>(section: string, items: T[]) => {
    const { kept, dropped: d } = filterGrounded(items, ev);
    d.forEach((item) => dropped.push({ section, item }));
    return kept;
  };
  const postIds = new Set(ev.filter((e) => e.kind === "post").map((e) => e.id));
  const result: AnalysisResult = {
    niche: keep("niche", [r.niche])[0] ?? { value: "Unclear from available data", evidence: [] },
    content_themes: keep("content_themes", r.content_themes),
    communication_style: keep("communication_style", [r.communication_style])[0] ?? { description: "Not enough evidence", evidence: [] },
    audience_interests: keep("audience_interests", r.audience_interests),
    top_content: keep("top_content", r.top_content).filter((t) => {
      if (postIds.has(t.evidence_id)) return true;
      dropped.push({ section: "top_content", item: t });
      return false;
    }),
    potential_problems: keep("potential_problems", r.potential_problems),
    software_ideas: keep("software_ideas", r.software_ideas),
    collaboration_opportunities: keep("collaboration_opportunities", r.collaboration_opportunities),
    data_gaps: r.data_gaps,
  };
  return { result, dropped };
}

export { buildEvidence };
export type { CreatorPost };
