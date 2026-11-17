import type { AnalysisResult } from "@/lib/ai/analysis";
import type { Evidence } from "@/lib/ai/evidence";

function Cites({ ids, ev }: { ids: string[]; ev: Map<string, Evidence> }) {
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {ids.map((id) => {
        const e = ev.get(id);
        const cls = "rounded bg-muted px-1 text-[10px] font-mono text-muted-foreground hover:bg-primary hover:text-primary-foreground";
        return e?.url ? (
          <a key={id} href={e.url} target="_blank" rel="noreferrer" title={e.text} className={cls}>
            {id}
          </a>
        ) : (
          <span key={id} title={e?.text} className={cls}>
            {id}
          </span>
        );
      })}
    </span>
  );
}

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section>
      <h3 className="text-sm font-semibold">{title}</h3>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <div className="mt-1.5 text-sm">{children}</div>
    </section>
  );
}

const None = () => <p className="text-muted-foreground italic">Nothing supported by the collected data.</p>;

export function AnalysisView({ result: r, evidence, dropped }: { result: AnalysisResult; evidence: Evidence[]; dropped?: unknown[] }) {
  const ev = new Map(evidence.map((e) => [e.id, e]));
  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <Section title="Niche">
          {r.niche.value}
          <Cites ids={r.niche.evidence} ev={ev} />
        </Section>
        <Section title="Communication style">
          {r.communication_style.description}
          <Cites ids={r.communication_style.evidence} ev={ev} />
        </Section>
      </div>

      <Section title="Content themes">
        {r.content_themes.length ? (
          <ul className="list-disc space-y-1 pl-5">
            {r.content_themes.map((t, i) => (
              <li key={i}>
                {t.theme}
                <Cites ids={t.evidence} ev={ev} />
              </li>
            ))}
          </ul>
        ) : (
          <None />
        )}
      </Section>

      <Section title="Most successful recent content">
        {r.top_content.length ? (
          <ul className="space-y-1.5">
            {r.top_content.map((t, i) => (
              <li key={i}>
                <a href={ev.get(t.evidence_id)?.url} target="_blank" rel="noreferrer" className="font-mono text-xs underline">
                  {t.evidence_id}
                </a>{" "}
                — {t.why_it_worked}
                <div className="truncate text-xs text-muted-foreground">{ev.get(t.evidence_id)?.text}</div>
              </li>
            ))}
          </ul>
        ) : (
          <None />
        )}
      </Section>

      <Section title="Audience interests">
        {r.audience_interests.length ? (
          <ul className="space-y-1">
            {r.audience_interests.map((a, i) => (
              <li key={i}>
                {a.interest}{" "}
                <span
                  className={
                    a.confidence === "supported" ? "text-xs text-emerald-700 dark:text-emerald-400" : "text-xs text-amber-700 dark:text-amber-400"
                  }
                >
                  ({a.confidence})
                </span>
                <Cites ids={a.evidence} ev={ev} />
              </li>
            ))}
          </ul>
        ) : (
          <None />
        )}
      </Section>

      <div className="grid gap-5 md:grid-cols-2">
        <Section title="Potential problems" note="Hypotheses inferred from content, not confirmed by the creator.">
          {r.potential_problems.length ? (
            <ul className="space-y-2">
              {r.potential_problems.map((p, i) => (
                <li key={i}>
                  <div className="font-medium">
                    {p.problem}
                    <Cites ids={p.evidence} ev={ev} />
                  </div>
                  <div className="text-muted-foreground">{p.reasoning}</div>
                </li>
              ))}
            </ul>
          ) : (
            <None />
          )}
        </Section>
        <Section title="Software ideas">
          {r.software_ideas.length ? (
            <ul className="space-y-2">
              {r.software_ideas.map((p, i) => (
                <li key={i}>
                  <div className="font-medium">
                    {p.idea}
                    <Cites ids={p.evidence} ev={ev} />
                  </div>
                  <div className="text-muted-foreground">Addresses: {p.addresses}</div>
                </li>
              ))}
            </ul>
          ) : (
            <None />
          )}
        </Section>
      </div>

      <Section title="Collaboration opportunities">
        {r.collaboration_opportunities.length ? (
          <ul className="list-disc space-y-1 pl-5">
            {r.collaboration_opportunities.map((o, i) => (
              <li key={i}>
                {o.opportunity}
                <Cites ids={o.evidence} ev={ev} />
              </li>
            ))}
          </ul>
        ) : (
          <None />
        )}
      </Section>

      {r.data_gaps.length > 0 && (
        <Section title="Data gaps">
          <ul className="list-disc pl-5 text-muted-foreground">
            {r.data_gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </Section>
      )}

      <details className="rounded-lg border p-3 text-xs">
        <summary className="cursor-pointer font-medium">
          Evidence the model was given ({evidence.length}){dropped?.length ? ` · ${dropped.length} ungrounded claim(s) removed` : ""}
        </summary>
        <ul className="mt-2 space-y-1">
          {evidence.map((e) => (
            <li key={e.id}>
              <span className="font-mono">{e.id}</span> {e.text}
            </li>
          ))}
        </ul>
        {!!dropped?.length && <pre className="mt-2 overflow-x-auto rounded bg-muted p-2">{JSON.stringify(dropped, null, 1)}</pre>}
      </details>
    </div>
  );
}
