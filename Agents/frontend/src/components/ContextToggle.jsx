export default function ContextToggle({ enabled, onChange }) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Context mode"
        onClick={() => onChange(!enabled)}
        className={[
          "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200",
          enabled ? "bg-accent" : "bg-mist",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200",
            enabled ? "translate-x-5" : "translate-x-0.5",
          ].join(" ")}
        />
      </button>
      <p className="text-[11px] leading-snug text-ink/60 max-w-[220px]">
        {enabled
          ? "Using your brand data + competitor insights"
          : "General marketing assistant"}
      </p>
    </div>
  );
}
