import { describe, expect, test } from "vitest";
import { nanoid } from "nanoid";
import { SimpleWorkflow } from "../simple-workflow";

const workflow = new SimpleWorkflow(
  "hello-world",
  () => "Hello, Simple Workflows!"
);

describe("run", () => {
  test("returns 'Hello, Simple Workflows!'", async () => {
    const jobId = nanoid();

    const job = await workflow.start(jobId, {});

    expect(await job.getResult()).toEqual({
      isSuccess: true,
      result: "Hello, Simple Workflows!",
    });
  });
});
