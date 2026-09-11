import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolCall } from "../domain";
import { runToolCall } from "../gateway/orchestrator";

export const MCP_TOOL_NAMES = [
  "scanner_scan",
  "github_get_pull_request",
  "github_read_file",
  "github_merge_pull_request",
  "task_complete",
] as const;

interface McpToolDef {
  name: (typeof MCP_TOOL_NAMES)[number];
  gatewayTool: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
}

// plan-04 EXACT tool list — name → underlying gateway tool. Every tool funnels
// into runToolCall so audit chains are transport-independent (plan-00 §H).
const TOOLS: McpToolDef[] = [
  {
    name: "scanner_scan",
    gatewayTool: "scanner.scan",
    description: "Scan a target through the Cubic authorization gateway (paid service in plan-05).",
    inputSchema: {
      target: z.string().min(1),
      task_id: z.string().uuid().optional(),
      purchase: z.boolean().optional(),
      price_usd_cents: z.number().int().optional(),
    },
  },
  {
    name: "github_get_pull_request",
    gatewayTool: "github.get_pull_request",
    description: "Fetch a pull request's review state through the Cubic authorization gateway.",
    inputSchema: {
      repo: z.string().min(1),
      pr: z.number().int(),
      task_id: z.string().uuid().optional(),
    },
  },
  {
    name: "github_read_file",
    gatewayTool: "github.read_file",
    description: "Read a file from a repository through the Cubic authorization gateway.",
    inputSchema: {
      repo: z.string().min(1),
      path: z.string().min(1),
      task_id: z.string().uuid().optional(),
    },
  },
  {
    name: "github_merge_pull_request",
    gatewayTool: "github.merge_pull_request",
    description: "Merge a pull request through the Cubic authorization gateway (high risk; policy may escalate).",
    inputSchema: {
      repo: z.string().min(1),
      pr: z.number().int(),
      task_id: z.string().uuid().optional(),
    },
  },
  {
    name: "task_complete",
    gatewayTool: "task.complete",
    description: "Mark the current Cubic task completed.",
    inputSchema: {
      task_id: z.string().uuid().optional(),
    },
  },
];

// plan-04 EXACT — MCP facade over ingest; agent identity comes from the
// x-cubic-agent header (no custom auth). Stateless: a fresh McpServer per
// request/call site.
export function createMcpServer(agentKey: string): McpServer {
  const server = new McpServer({ name: "cubic", version: "0.1.0" });
  for (const def of TOOLS) {
    server.registerTool(
      def.name,
      { title: def.name, description: def.description, inputSchema: def.inputSchema },
      async (args) => {
        const { task_id, ...rest } = (args ?? {}) as Record<string, unknown>;
        const call: ToolCall = {
          ...(task_id != null ? { task_id: String(task_id) } : {}),
          agent_key: agentKey,
          tool: def.gatewayTool,
          arguments: rest,
        };
        const result = await runToolCall(call);
        if (result.ok) {
          // Each tool returns the full tool-call data JSON as its content.
          return { content: [{ type: "text" as const, text: JSON.stringify(result.data) }] };
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: result.error }) }],
          isError: true,
        };
      },
    );
  }
  return server;
}
