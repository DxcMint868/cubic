import { config } from "../config";
import type { Executor, ExecutorResult } from "./registry";

const GITHUB_API = "https://api.github.com";

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "cubic-gateway",
  };
}

// plan-04 EXACT — with GITHUB_TOKEN set, call the real GitHub API
// (mode:"real"); without it, canned deterministic responses (mode:"mock").
export class GithubExecutor implements Executor {
  async execute(input: Parameters<Executor["execute"]>[0]): Promise<ExecutorResult> {
    const { capability, args } = input;
    const repo = String(args.repo ?? "");
    const pr = args.pr;
    const path = String(args.path ?? "");
    const token = config().GITHUB_TOKEN;

    switch (capability.action) {
      case "get_pull_request": {
        if (!token) {
          return {
            summary: `PR #${pr} 'Fix auth flow' — CI passing, approved (mock)`,
            result: { repo, pr, title: "Fix auth flow", ci: "passing", approved: true },
            mode: "mock",
          };
        }
        const res = await fetch(`${GITHUB_API}/repos/${repo}/pulls/${pr}`, { headers: authHeaders(token) });
        if (!res.ok) throw new Error(`github.get_pull_request: HTTP ${res.status}`);
        const data = (await res.json()) as { title?: string; state?: string; merged?: boolean };
        return {
          summary: `PR #${pr} '${data.title ?? "untitled"}' — state ${data.state ?? "unknown"} (real)`,
          result: { repo, pr, title: data.title ?? null, state: data.state ?? null, merged: data.merged ?? false },
          mode: "real",
        };
      }
      case "read_file": {
        if (!token) {
          return {
            summary: `Read ${path} (mock)`,
            result: { path, content: "mock file content" },
            mode: "mock",
          };
        }
        const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, { headers: authHeaders(token) });
        if (!res.ok) throw new Error(`github.read_file: HTTP ${res.status}`);
        const data = (await res.json()) as { content?: string; encoding?: string };
        const content =
          typeof data.content === "string" && data.encoding === "base64"
            ? Buffer.from(data.content, "base64").toString("utf8")
            : null;
        return { summary: `Read ${path} (real)`, result: { path, content }, mode: "real" };
      }
      case "merge_pull_request": {
        if (!token) {
          return {
            summary: `Merged PR #${pr} (mock)`,
            result: { merged: true },
            mode: "mock",
          };
        }
        const res = await fetch(`${GITHUB_API}/repos/${repo}/pulls/${pr}/merge`, {
          method: "PUT",
          headers: authHeaders(token),
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error(`github.merge_pull_request: HTTP ${res.status}`);
        const data = (await res.json()) as { merged?: boolean; sha?: string };
        return {
          summary: `Merged PR #${pr} (real)`,
          result: { merged: data.merged ?? false, sha: data.sha ?? null },
          mode: "real",
        };
      }
      default:
        // plan-10: deploy.production normalizes to action deploy_production and
        // the seed wires it to this executor, but no case handled it — every
        // approved deploy died with "unsupported action". There is no real
        // deploy target in the MVP, so this is mock-always (labeled as such);
        // the authorization chain around it (escalate → approval → capability
        // → execution) is the real, tested behavior.
        if (capability.action === "deploy_production") {
          return {
            summary: `Deployed ${repo} to production (mock)`,
            result: { repo, environment: "production", deployed: true },
            mode: "mock",
          };
        }
        throw new Error(`github executor: unsupported action ${capability.action}`);
    }
  }
}
