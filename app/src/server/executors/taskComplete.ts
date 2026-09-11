import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { tasks } from "../db/schema";
import type { Executor, ExecutorResult } from "./registry";

// plan-04 step 5 — task.complete: mark the task completed and return summary
// "Task completed". The orchestrator emits task.completed after the execution
// lifecycle so the trace order stays sane (started → completed → task.completed).
export class TaskCompleteExecutor implements Executor {
  async execute(input: Parameters<Executor["execute"]>[0]): Promise<ExecutorResult> {
    const taskId = input.capability.resource; // normalize() sets resource = taskId
    const [task] = await db().select().from(tasks).where(eq(tasks.id, taskId));
    if (!task) throw new Error(`task executor: task not found ${taskId}`);
    if (task.status !== "open") throw new Error(`task executor: task ${taskId} is ${task.status}, not open`);
    await db().update(tasks).set({ status: "completed" }).where(eq(tasks.id, taskId));
    return {
      summary: "Task completed",
      result: { task_id: task.id, status: "completed" },
      mode: "dev",
    };
  }
}
