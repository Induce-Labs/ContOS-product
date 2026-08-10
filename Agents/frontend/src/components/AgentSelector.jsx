const PLATFORMS = [
  { id: "chat", label: "Chat" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "instagram", label: "Instagram" },
  { id: "playbook", label: "Playbook" },
];

export default function AgentSelector({ activeAgent, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Platform">
      {PLATFORMS.map((agent) => {
        const active = activeAgent === agent.id;
        return (
          <button
            key={agent.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(agent.id)}
            className={[
              "rounded-md px-3 py-1.5 text-xs font-semibold tracking-wide transition-all duration-200",
              active
                ? "bg-ink text-paper"
                : "bg-paper text-ink/65 hover:bg-white hover:text-ink border border-line",
            ].join(" ")}
          >
            {agent.label}
          </button>
        );
      })}
    </div>
  );
}
