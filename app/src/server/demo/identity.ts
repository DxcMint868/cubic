// plan-16 — demo agent identity (server/demo/identity.ts).
//
// Reads the same per-agent docs the console profile route serves
// (data/agents/<agent-key>/SOUL.md + MEMORY.md, key slugified like the
// console's docsDir) so the chat parser can speak AS the agent instead of a
// generic bot. File reads are capped — the prompt carries voice, not the
// whole archive. Missing docs → nulls, never throws.

import { readFile } from "node:fs/promises";

const DOC_CHAR_CAP = 1500;

function docsDir(agentKey: string): string {
  const safe = agentKey.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  return `${process.cwd()}/data/agents/${safe}`;
}

async function readDoc(agentKey: string, file: "SOUL.md" | "MEMORY.md"): Promise<string | null> {
  try {
    const text = (await readFile(`${docsDir(agentKey)}/${file}`, "utf8")).trim();
    if (text === "") return null;
    return text.length > DOC_CHAR_CAP ? `${text.slice(0, DOC_CHAR_CAP)}…[truncated]` : text;
  } catch {
    return null;
  }
}

export interface AgentIdentity {
  key: string;
  name: string;
  soul: string | null;
  memory: string | null;
  tools: string[];
}

export async function loadAgentIdentity(
  agentKey: string,
  name: string,
  tools: string[],
): Promise<AgentIdentity> {
  const [soul, memory] = await Promise.all([
    readDoc(agentKey, "SOUL.md"),
    readDoc(agentKey, "MEMORY.md"),
  ]);
  return { key: agentKey, name, soul, memory, tools };
}

/** Canned voice for no-tool turns when the model produced no reply at all. */
export function redirectFor(agent: Pick<AgentIdentity, "key" | "name" | "tools">): string {
  const tools = agent.tools.length > 0 ? agent.tools.join(", ") : "no tools in this demo";
  return `I am ${agent.name} (${agent.key}). Through the gateway I can use: ${tools} — try a scenario below.`;
}
