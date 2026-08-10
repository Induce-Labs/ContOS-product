function isVideoType(type) {
  const t = (type || "").toLowerCase();
  return t.includes("reel") || t.includes("video") || t.includes("story");
}

function TranscriptBlock({ text, contentType }) {
  if (!text || !String(text).trim()) {
    if (isVideoType(contentType)) {
      return (
        <p className="mt-2 text-xs text-warn/80 italic">
          Transcript missing — ask again or regenerate for a spoken script.
        </p>
      );
    }
    return null;
  }
  return (
    <div className="mt-3 rounded-md border border-line bg-paper/80 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-accent mb-1.5">
        Video transcript
      </p>
      <p className="text-xs text-ink/80 whitespace-pre-wrap leading-relaxed">{text}</p>
    </div>
  );
}

function Reasoning({ text }) {
  if (!text) return null;
  return (
    <p className="mt-2 text-xs text-ink/55 border-t border-line/70 pt-2">
      <span className="font-semibold text-accent">Why: </span>
      {text}
    </p>
  );
}

function InstagramView({ output }) {
  const responseType = output?.response_type || "content_calendar";

  if (responseType === "competitor_comparison") {
    const cards = output?.competitor_comparison || [];
    return (
      <div className="space-y-4">
        {output?.comparison_summary && (
          <p className="text-sm text-ink/80 whitespace-pre-wrap leading-relaxed">
            {output.comparison_summary}
          </p>
        )}
        <div className="space-y-3">
          {cards.map((card, idx) => (
            <article
              key={idx}
              className="rounded-lg border border-line bg-white/70 p-4 animate-fade-up"
              style={{ animationDelay: `${idx * 40}ms` }}
            >
              <p className="text-xs uppercase tracking-wide text-accent">
                {card.platform || "instagram"}
              </p>
              <h4 className="font-display text-lg mt-1">
                {card.competitor_handle || `Competitor ${idx + 1}`}
              </h4>
              {!!card.key_signals?.length && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-ink/50 uppercase tracking-wider">
                    Key signals
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-ink/80 space-y-1">
                    {card.key_signals.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!!card.hooks_and_themes?.length && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-ink/50 uppercase tracking-wider">
                    Hooks and themes
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-ink/80 space-y-1">
                    {card.hooks_and_themes.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!!card.strengths?.length && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-ink/50 uppercase tracking-wider">
                    Strengths
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-ink/80 space-y-1">
                    {card.strengths.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!!card.weaknesses?.length && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-ink/50 uppercase tracking-wider">
                    Weaknesses
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-ink/80 space-y-1">
                    {card.weaknesses.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          ))}
        </div>
        {!!output?.differentiation_angles?.length && (
          <div>
            <p className="text-sm font-semibold mb-1">Differentiation for ContOS</p>
            <ul className="list-disc pl-5 text-sm text-ink/80 space-y-1">
              {output.differentiation_angles.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (responseType === "analysis") {
    return (
      <div className="rounded-lg border border-line bg-white/70 p-4 text-sm text-ink/80 whitespace-pre-wrap leading-relaxed">
        {output?.analysis || "No analysis returned."}
      </div>
    );
  }

  const rows = output?.content_calendar || [];
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {rows.map((row, idx) => (
          <article
            key={idx}
            className="rounded-lg border border-line bg-white/70 p-4 animate-fade-up"
            style={{ animationDelay: `${idx * 40}ms` }}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-ink/45">
              <span className="font-mono">Day {row.day}</span>
              {row.date && <span>· {row.date}</span>}
              <span className="rounded bg-accent/10 px-2 py-0.5 font-semibold text-accent normal-case tracking-normal">
                {row.content_type}
              </span>
            </div>
            <p className="mt-2 font-medium text-ink">{row.hook}</p>
            <p className="mt-2 text-sm text-ink/80 whitespace-pre-wrap">{row.caption}</p>
            {!!row.hashtags?.length && (
              <p className="mt-2 text-xs text-accentSoft">
                {row.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}
              </p>
            )}
            {row.cta && (
              <p className="mt-2 text-sm font-medium text-ink/70">CTA: {row.cta}</p>
            )}
            {row.audio_suggestion && (
              <p className="mt-1 text-xs text-ink/50">Audio: {row.audio_suggestion}</p>
            )}
            <TranscriptBlock text={row.transcript} contentType={row.content_type} />
            <Reasoning text={row.reasoning} />
          </article>
        ))}
      </div>
      {output?.posting_frequency && (
        <p className="text-sm text-ink/70">
          Frequency: <span className="font-medium text-ink">{output.posting_frequency}</span>
        </p>
      )}
      {!!output?.top_hooks?.length && (
        <div>
          <p className="text-sm font-semibold mb-1">Top hooks</p>
          <ul className="list-disc pl-5 text-sm text-ink/80 space-y-1">
            {output.top_hooks.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function LinkedInView({ output }) {
  const ideas = output?.post_ideas || [];
  return (
    <div className="space-y-3">
      {ideas.map((idea, idx) => (
        <article
          key={idx}
          className="rounded-lg border border-line bg-white/70 p-4 animate-fade-up"
          style={{ animationDelay: `${idx * 40}ms` }}
        >
          <p className="text-xs uppercase tracking-wide text-accent">{idea.content_type}</p>
          <h4 className="font-display text-lg mt-1">{idea.topic}</h4>
          <p className="mt-2 font-medium">{idea.hook}</p>
          <p className="mt-2 text-sm text-ink/75 whitespace-pre-wrap">{idea.post_structure}</p>
          {idea.cta && <p className="mt-2 text-sm font-medium text-accentSoft">CTA: {idea.cta}</p>}
          <TranscriptBlock text={idea.transcript} contentType={idea.content_type} />
          <Reasoning text={idea.reasoning} />
        </article>
      ))}
      {output?.content_mix && (
        <p className="text-sm text-ink/65">
          Mix — text {output.content_mix.text_posts}, carousels {output.content_mix.carousels},
          videos {output.content_mix.videos}
        </p>
      )}
    </div>
  );
}

function PlaybookView({ output }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-ink/50">Audit</span>
        <span
          className={[
            "rounded px-2 py-0.5 text-xs font-semibold",
            output?.audit_result === "PASSED"
              ? "bg-accent/15 text-accent"
              : output?.audit_result === "FAILED"
                ? "bg-warn/15 text-warn"
                : "bg-mist text-ink/70",
          ].join(" ")}
        >
          {output?.audit_result || "N/A"}
        </span>
      </div>

      {!!output?.strategy_frameworks?.length && (
        <section>
          <h4 className="font-display text-base mb-1">Strategy frameworks</h4>
          <ul className="list-disc pl-5 space-y-1 text-ink/80">
            {output.strategy_frameworks.map((item, i) => (
              <li key={i}>{typeof item === "string" ? item : JSON.stringify(item)}</li>
            ))}
          </ul>
        </section>
      )}

      {!!output?.guardrails?.length && (
        <section>
          <h4 className="font-display text-base mb-1">Guardrails</h4>
          <ul className="list-disc pl-5 space-y-1 text-ink/80">
            {output.guardrails.map((item, i) => (
              <li key={i}>{typeof item === "string" ? item : JSON.stringify(item)}</li>
            ))}
          </ul>
        </section>
      )}

      {!!output?.recommendations?.length && (
        <section>
          <h4 className="font-display text-base mb-1">Recommendations</h4>
          <ul className="list-disc pl-5 space-y-1 text-ink/80">
            {output.recommendations.map((item, i) => (
              <li key={i}>{typeof item === "string" ? item : JSON.stringify(item)}</li>
            ))}
          </ul>
        </section>
      )}

      {!!output?.broken_rules?.length && (
        <section>
          <h4 className="font-display text-base mb-1 text-warn">Broken rules</h4>
          <ul className="list-disc pl-5 space-y-1">
            {output.broken_rules.map((item, i) => (
              <li key={i}>{typeof item === "string" ? item : JSON.stringify(item)}</li>
            ))}
          </ul>
        </section>
      )}

      {output?.reasoning && (
        <p className="border-t border-line pt-3 text-ink/70 whitespace-pre-wrap">
          {output.reasoning}
        </p>
      )}
    </div>
  );
}

function ChatView({ text }) {
  return (
    <div className="rounded-2xl bg-white/80 border border-line px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
      {typeof text === "string" ? text.replace(/\*/g, "") : text}
    </div>
  );
}

function stripStars(value) {
  if (value == null) return value;
  if (typeof value === "string") return value.replace(/\*/g, "");
  if (Array.isArray(value)) return value.map(stripStars);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripStars(v);
    return out;
  }
  return value;
}

export default function OutputRenderer({ agent, output, streamingText }) {
  const cleanStreaming =
    typeof streamingText === "string" ? streamingText.replace(/\*/g, "") : streamingText;
  const cleanOutput = stripStars(output);

  if (agent === "chatbot") {
    return (
      <ChatView
        text={typeof cleanOutput === "string" ? cleanOutput : cleanStreaming || ""}
      />
    );
  }

  // Parse failures: still show whatever streamed / raw excerpt
  if (
    cleanOutput?.error &&
    (cleanOutput?.display_text || cleanOutput?.raw_response_excerpt || cleanStreaming)
  ) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-warn bg-warn/10 border border-warn/20 rounded-lg px-3 py-2">
          Couldn’t parse structured output — showing raw response. Try again or ask for fewer days.
        </p>
        <pre className="text-xs font-mono whitespace-pre-wrap text-ink/70 bg-white/50 rounded-lg p-3 border border-line max-h-96 overflow-auto">
          {cleanOutput.display_text ||
            cleanOutput.raw_response_excerpt ||
            cleanStreaming}
        </pre>
      </div>
    );
  }

  if (!cleanOutput || typeof cleanOutput !== "object") {
    if (cleanStreaming) {
      return (
        <pre className="text-xs font-mono whitespace-pre-wrap text-ink/70 bg-white/50 rounded-lg p-3 border border-line">
          {cleanStreaming}
        </pre>
      );
    }
    return null;
  }

  if (agent === "instagram") return <InstagramView output={cleanOutput} />;
  if (agent === "linkedin") return <LinkedInView output={cleanOutput} />;
  if (agent === "playbook") return <PlaybookView output={cleanOutput} />;

  return (
    <pre className="text-xs font-mono whitespace-pre-wrap overflow-auto">
      {JSON.stringify(cleanOutput, null, 2)}
    </pre>
  );
}
