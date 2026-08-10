import { useEffect, useRef, useState } from "react";
import AgentSelector from "./AgentSelector.jsx";
import CompetitorTable, {
  emptyCompetitorRows,
  getFilledCompetitors,
} from "./CompetitorTable.jsx";
import ContextToggle from "./ContextToggle.jsx";
import OutputRenderer from "./OutputRenderer.jsx";
import {
  BROAD_CONTENT_QUICK_ACTIONS,
  SPECIALIZED_PLATFORMS,
  buildClarificationPrompt,
  buildMultiPlatformPrompt,
  detectPrimaryPlatform,
  isAffirmative,
  isBroadContentRequest,
  stripAsterisks,
  wantsAllPlatforms,
} from "../lib/chatIntent.js";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

function isCasualMessage(text) {
  const t = text.trim().toLowerCase();
  if (!t || t.length > 80) return false;
  return /^(hi|hii+|hello|hey|yo|sup|hiya|good\s*(morning|afternoon|evening)|howdy|hola|thanks|thank you|ok|okay|cool|great|bye|goodbye)([\s,.!?]|$)/i.test(
    t
  );
}

function resolveAgentType(platform, text) {
  if (isCasualMessage(text)) return "chatbot";
  if (platform === "chat") return "chatbot";
  return platform;
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildUserInput(text, platform, competitors, agentType) {
  const lines = [];
  if (agentType === "chatbot" && isCasualMessage(text)) {
    return text;
  }
  if (competitors.length && (agentType !== "chatbot" || !isCasualMessage(text))) {
    lines.push("Competitor links provided by user:");
    competitors.forEach((c, i) => {
      lines.push(`${i + 1}. [${c.platform}] ${c.url}`);
    });
    lines.push("");
  }
  lines.push(text);
  return lines.join("\n");
}

export default function ChatWindow({ userId, projectId }) {
  const [platform, setPlatform] = useState("chat");
  const [contextOn, setContextOn] = useState(true);
  const [competitors, setCompetitors] = useState(() => emptyCompetitorRows(10));
  const [showCompetitors, setShowCompetitors] = useState(true);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState("");
  const [pendingBroad, setPendingBroad] = useState(null);
  const [knowledgeBase, setKnowledgeBase] = useState([]);
  const [kbUpdating, setKbUpdating] = useState(false);
  const bottomRef = useRef(null);
  const platformRef = useRef(platform);
  const knowledgeRef = useRef([]);
  const ingestedKeysRef = useRef(new Set());
  platformRef.current = platform;
  knowledgeRef.current = knowledgeBase;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  // When competitor links are added/changed → ingest into knowledge base + notify in chat
  useEffect(() => {
    const filled = getFilledCompetitors(competitors).filter(
      (c) => c.url.length >= 5
    );
    const newcomers = filled.filter((c) => {
      const key = `${c.platform}|${c.url.toLowerCase()}`;
      return !ingestedKeysRef.current.has(key);
    });
    if (!newcomers.length) return undefined;

    const timer = setTimeout(async () => {
      setKbUpdating(true);
      setStatus("Updating knowledge base…");
      try {
        const res = await fetch(`${API_BASE}/api/competitors/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            competitors: newcomers.map((c) => ({
              url: c.url,
              platform: c.platform,
            })),
          }),
        });
        if (!res.ok) {
          let detail = `Ingest failed: HTTP ${res.status}`;
          try {
            const errBody = await res.json();
            const msg = errBody?.detail?.message || errBody?.detail || errBody?.message;
            if (msg) detail = typeof msg === "string" ? msg : JSON.stringify(msg);
          } catch {
            /* keep status text */
          }
          throw new Error(detail);
        }
        const data = await res.json();
        const added = data.competitors || [];
        for (const item of added) {
          ingestedKeysRef.current.add(
            `${item.platform}|${String(item.url || "").toLowerCase()}`
          );
        }
        setKnowledgeBase((prev) => {
          const byKey = new Map(
            prev.map((p) => [`${p.platform}|${String(p.url || "").toLowerCase()}`, p])
          );
          for (const item of added) {
            byKey.set(
              `${item.platform}|${String(item.url || "").toLowerCase()}`,
              item
            );
          }
          return Array.from(byKey.values());
        });

        const notice =
          data.message ||
          "Your knowledge base / competitor data has been updated. You can ask about their tactics, hooks, and content themes.";
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: "assistant",
            agent: "chatbot",
            platform: "chat",
            output: notice,
            streamingText: notice,
            systemNotice: true,
            kbUpdate: true,
          },
        ]);
        setStatus("knowledge base updated");
      } catch (err) {
        setStatus("kb update error");
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: "assistant",
            agent: "chatbot",
            platform: "chat",
            error: err.message || String(err),
            output: null,
            streamingText: "",
          },
        ]);
      } finally {
        setKbUpdating(false);
      }
    }, 900);

    return () => clearTimeout(timer);
  }, [competitors, projectId]);

  async function invokeAgent({
    text,
    agentType,
    uiPlatform,
    userInput,
    notice,
    quickActions,
  }) {
    const filled = getFilledCompetitors(competitors);
    const primaryLink =
      agentType === "chatbot" && isCasualMessage(text)
        ? null
        : filled.find((c) => c.platform === uiPlatform)?.url ||
          filled.find((c) => c.platform === agentType)?.url ||
          filled[0]?.url ||
          null;
    const summaries = knowledgeRef.current;

    if (notice) {
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "assistant",
          agent: "chatbot",
          platform: "chat",
          output: notice,
          streamingText: notice,
          systemNotice: true,
        },
      ]);
    }

    const assistantId = newId();
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: "assistant",
        agent: agentType,
        platform: uiPlatform,
        streamingText: "",
        output: null,
        error: null,
        quickActions: quickActions || null,
      },
    ]);
    setStreaming(true);
    setStatus("Connecting…");

    try {
      const res = await fetch(`${API_BASE}/api/agents/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          user_id: userId,
          project_id: projectId,
          agent_type: agentType,
          user_input: userInput,
          live_mode: Boolean(primaryLink) && agentType !== "chatbot",
          chatbot_context_on:
            agentType === "chatbot" ? Boolean(contextOn || summaries.length) : false,
          competitor_url: primaryLink,
          competitor_summaries: summaries.length ? summaries : null,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const lines = part.split("\n");
          let event = "message";
          let dataLine = "";
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            if (line.startsWith("data:")) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;

          let data;
          try {
            data = JSON.parse(dataLine);
          } catch {
            continue;
          }

          if (event === "status") {
            setStatus(data.stage || "working");
          } else if (event === "token") {
            accumulated += data.token || "";
            const clean = stripAsterisks(accumulated);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, streamingText: clean } : m
              )
            );
          } else if (event === "complete") {
            const finalOutput = stripAsterisks(data.output);
            setStatus(data.status || "done");
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      output: finalOutput,
                      streamingText:
                        typeof finalOutput === "string"
                          ? finalOutput
                          : stripAsterisks(accumulated),
                      usage: data.usage,
                      quickActions: quickActions || m.quickActions,
                    }
                  : m
              )
            );
          } else if (event === "error") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      error: data.error,
                      output: data.output,
                      streamingText: accumulated,
                    }
                  : m
              )
            );
            setStatus("error");
          }
        }
      }
    } catch (err) {
      setStatus("error");
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, error: err.message || String(err) } : m
        )
      );
    } finally {
      setStreaming(false);
    }
  }

  async function runSpecializedPlatforms(platforms, originalText) {
    for (const p of platforms) {
      setPlatform(p);
      const label = p.charAt(0).toUpperCase() + p.slice(1);
      await invokeAgent({
        text: originalText,
        agentType: p,
        uiPlatform: p,
        userInput: buildUserInput(
          buildMultiPlatformPrompt(originalText, p),
          p,
          getFilledCompetitors(competitors),
          p
        ),
        notice: `Running the ${label} agent…`,
      });
    }
    setPlatform("chat");
    setPendingBroad(null);
  }

  async function handleQuickAction(action, sourceText) {
    if (streaming) return;
    const original = sourceText || pendingBroad?.text || "Create a month-long content plan";
    setMessages((prev) => [
      ...prev,
      {
        id: newId(),
        role: "user",
        text: action.label,
        agent: "chatbot",
        platform: "chat",
      },
    ]);
    await runSpecializedPlatforms(action.platforms, original);
  }

  async function sendMessage(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setMessages((prev) => [
      ...prev,
      {
        id: newId(),
        role: "user",
        text,
        agent: resolveAgentType(platform, text),
        platform,
      },
    ]);

    const currentPlatform = platformRef.current;

    // --- General Chat routing ---
    if (currentPlatform === "chat" && !isCasualMessage(text)) {
      const mentioned = detectPrimaryPlatform(text);

      // Specific platform named → auto-trigger specialized agent
      if (mentioned && mentioned.id !== "playbook") {
        const target = mentioned.id;
        setPlatform(target);
        setPendingBroad(null);
        await invokeAgent({
          text,
          agentType: target,
          uiPlatform: target,
          userInput: buildUserInput(
            text,
            target,
            getFilledCompetitors(competitors),
            target
          ),
          notice: `You mentioned ${mentioned.label} — switching to the ${mentioned.label} agent.`,
        });
        return;
      }

      if (mentioned?.id === "playbook") {
        setPlatform("playbook");
        await invokeAgent({
          text,
          agentType: "playbook",
          uiPlatform: "playbook",
          userInput: buildUserInput(
            text,
            "playbook",
            getFilledCompetitors(competitors),
            "playbook"
          ),
          notice: "Routing to the Playbook agent for strategy / guardrails.",
        });
        return;
      }

      // User confirms all platforms after a broad ask
      if (
        (pendingBroad || wantsAllPlatforms(text) || isAffirmative(text)) &&
        (wantsAllPlatforms(text) || (pendingBroad && isAffirmative(text)))
      ) {
        const original = pendingBroad?.text || text;
        await runSpecializedPlatforms(SPECIALIZED_PLATFORMS, original);
        return;
      }

      // Broad "content for a month" with no platform → clarify + quick actions
      if (isBroadContentRequest(text) || wantsAllPlatforms(text)) {
        if (wantsAllPlatforms(text) && !isBroadContentRequest(text)) {
          await runSpecializedPlatforms(SPECIALIZED_PLATFORMS, text);
          return;
        }
        setPendingBroad({ text });
        await invokeAgent({
          text,
          agentType: "chatbot",
          uiPlatform: "chat",
          userInput: buildClarificationPrompt(text),
          quickActions: BROAD_CONTENT_QUICK_ACTIONS,
        });
        return;
      }
    }

    // Default path (selected chip / normal chat)
    const agentType = resolveAgentType(currentPlatform, text);
    await invokeAgent({
      text,
      agentType,
      uiPlatform: currentPlatform,
      userInput: buildUserInput(
        text,
        currentPlatform,
        getFilledCompetitors(competitors),
        agentType
      ),
    });
  }

  const renderAgent = (msg) =>
    msg.systemNotice ? "chatbot" : msg.agent || "chatbot";

  return (
    <div className="flex h-[min(860px,calc(100vh-6rem))] flex-col overflow-hidden rounded-2xl border border-line bg-white/60 shadow-soft backdrop-blur-sm">
      <header className="shrink-0 border-b border-line bg-white/80 px-4 py-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-2xl tracking-tight text-ink">ContOS</p>
            <p className="text-xs text-ink/50 mt-0.5">Chatbot · fractional CMO assistant</p>
          </div>
          <p className="font-mono text-[10px] text-ink/40 pt-1">{status || "idle"}</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <AgentSelector activeAgent={platform} onChange={setPlatform} />
          <ContextToggle enabled={contextOn} onChange={setContextOn} />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-[11px] text-ink/45">
            Active:{" "}
            <span className="font-semibold text-ink/70 capitalize">
              {platform === "chat" ? "Chat" : platform}
            </span>
            {knowledgeBase.length > 0 && (
              <span className="ml-2 text-accent">
                · KB: {knowledgeBase.length} competitor
                {knowledgeBase.length === 1 ? "" : "s"}
              </span>
            )}
            {kbUpdating && <span className="ml-2 text-ink/40">· updating…</span>}
          </p>
          <button
            type="button"
            onClick={() => setShowCompetitors((v) => !v)}
            className="text-[11px] font-semibold text-accent hover:text-accentSoft transition"
          >
            {showCompetitors ? "Hide competitors" : "Show competitors"}
          </button>
        </div>
      </header>

      {showCompetitors && (
        <div className="shrink-0 max-h-[240px] overflow-y-auto">
          <CompetitorTable rows={competitors} onChange={setCompetitors} />
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="rounded-xl border border-dashed border-line bg-paper/50 p-6 text-center animate-fade-up">
            <p className="font-display text-xl text-ink">Ask ContOS</p>
            <p className="mt-2 text-sm text-ink/60 max-w-md mx-auto">
              In Chat, ask for a month of content and ContOS will clarify platforms — or name
              LinkedIn / Instagram to auto-run that agent.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={[
              "animate-fade-up max-w-[95%]",
              msg.role === "user" ? "ml-auto" : "mr-auto",
            ].join(" ")}
          >
            {msg.role === "user" ? (
              <div className="rounded-2xl bg-ink text-paper px-4 py-3 text-sm">
                <p className="text-[10px] uppercase tracking-wider text-paper/45 mb-1">
                  {msg.platform}
                </p>
                {msg.text}
              </div>
            ) : (
              <div className="space-y-2">
                {msg.systemNotice && (
                  <p
                    className={[
                      "text-[11px] font-medium rounded-lg px-3 py-1.5",
                      msg.kbUpdate
                        ? "text-accent bg-accent/10 border border-accent/20"
                        : "text-accent bg-accent/10",
                    ].join(" ")}
                  >
                    {typeof msg.output === "string" ? msg.output : msg.streamingText}
                  </p>
                )}
                {!msg.systemNotice && msg.error && (
                  <p className="text-sm text-warn bg-warn/10 border border-warn/20 rounded-lg px-3 py-2">
                    {msg.error}
                  </p>
                )}
                {!msg.systemNotice && (
                  <OutputRenderer
                    agent={renderAgent(msg)}
                    output={msg.output}
                    streamingText={msg.streamingText}
                  />
                )}
                {!!msg.quickActions?.length && !streaming && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {msg.quickActions.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        disabled={streaming}
                        onClick={() =>
                          handleQuickAction(action, pendingBroad?.text)
                        }
                        className="rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink/80 hover:border-accent hover:text-accent transition"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
                {streaming && msg.streamingText && !msg.output && !msg.systemNotice && (
                  <div className="flex gap-1 pl-1">
                    <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
                    <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
                    <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={sendMessage} className="shrink-0 border-t border-line bg-white/80 p-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Message ContOS (${platform})…`}
            disabled={streaming}
            className="flex-1 rounded-xl border border-line bg-paper px-4 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:bg-accentSoft disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
