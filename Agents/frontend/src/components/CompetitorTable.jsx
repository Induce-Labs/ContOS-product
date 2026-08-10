const PLATFORM_OPTIONS = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "instagram", label: "Instagram" },
];

export function emptyCompetitorRows(count = 10) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    platform: "linkedin",
    url: "",
  }));
}

export default function CompetitorTable({ rows, onChange }) {
  function updateRow(index, patch) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function clearAll() {
    onChange(emptyCompetitorRows(rows.length || 10));
  }

  const filled = rows.filter((r) => r.url.trim()).length;

  return (
    <div className="border-b border-line bg-paper/40">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink/50">
            Competitor links
          </p>
          <p className="text-[11px] text-ink/45 mt-0.5">
            Paste up to {rows.length} profiles · {filled} filled
          </p>
        </div>
        <button
          type="button"
          onClick={clearAll}
          className="text-[11px] font-medium text-ink/50 hover:text-warn transition"
        >
          Clear all
        </button>
      </div>

      <div className="overflow-x-auto px-3 pb-3">
        <table className="w-full min-w-[520px] border-collapse text-left text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-ink/40">
              <th className="w-10 px-2 py-1.5 font-medium">#</th>
              <th className="w-36 px-2 py-1.5 font-medium">Platform</th>
              <th className="px-2 py-1.5 font-medium">Competitor URL / handle</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.id}
                className="border-t border-line/80 hover:bg-white/50 transition-colors"
              >
                <td className="px-2 py-1.5 font-mono text-xs text-ink/40">{row.id}</td>
                <td className="px-2 py-1.5">
                  <select
                    value={row.platform === "twitter" || row.platform === "reddit" ? "linkedin" : row.platform}
                    onChange={(e) => updateRow(index, { platform: e.target.value })}
                    className="w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-accent"
                  >
                    {PLATFORM_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="url"
                    value={row.url}
                    onChange={(e) => updateRow(index, { url: e.target.value })}
                    placeholder={
                      row.platform === "instagram"
                        ? "https://instagram.com/…"
                        : "https://linkedin.com/company/…"
                    }
                    className="w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-xs outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function getFilledCompetitors(rows) {
  return rows
    .filter((r) => r.url.trim())
    .map((r) => ({
      platform: r.platform,
      url: r.url.trim(),
    }));
}
