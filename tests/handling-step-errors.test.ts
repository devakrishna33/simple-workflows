import { describe, expect, test } from "vitest";
import { SimpleWorkflow } from "../simple-workflow";
import { nanoid } from "nanoid";
import { Result } from "../result";
import { errorSchema } from "../utils";

const workflow = new SimpleWorkflow(
  "handling-step-errors",
  async ({ step }) => {
    try {
      await step.run(
        "a",
        () => {
          throw new Error("Oh no!");
        },
        {
          maxAttempts: 2,
        }
      );
    } catch (rawError) {
      await step.run("b", async () => {
        const error = errorSchema.safeParse(rawError);

        if (!error.success) {
          throw rawError;
        }

        return `err was: ${error.data.message}`;
      });
    }

    await Promise.all([
      step.run("c succeeds", async () => "c succeeds"),
      step
        .run(
          "d fails",
          () => {
            throw new Error("D failed!");
          },
          {
            maxAttempts: 2,
          }
        )
        .catch((err: Error) => {
          return step.run("e succeeds", async () => {
            return {
              errMessage: err.message,
            };
          });
        }),
    ]);
  }
);

describe("run", () => {
  test(`ran "a" step and it failed, twice`, async () => {
    const jobId = nanoid();

    const job = await workflow.start(jobId, {});

    await job.waitUntilFinished();

    const stepAttempts = await job.getStepAttempts("a");

    const stepResult = await job.getStepResult("a");

    expect(stepAttempts.length).toBe(2);

    expect(stepResult).toEqual(
      Result.fail({
        failedReason: "Oh no!",
        stack: expect.any(String),
      })
    );
  });

  test(`ran "b" step`, async () => {
    const jobId = nanoid();

    const job = await workflow.start(jobId, {});

    await job.waitUntilFinished();

    const stepAttempts = await job.getStepAttempts("b");

    const stepResult = await job.getStepResult("b");

    expect(stepAttempts.length).toBe(1);

    expect(stepResult).toEqual(Result.succeed("err was: Oh no!"));
  });

  test(`ran "c succeeds" step`, async () => {
    const jobId = nanoid();

    const job = await workflow.start(jobId, {});

    await job.waitUntilFinished();

    const stepAttempts = await job.getStepAttempts("c succeeds");

    const stepResult = await job.getStepResult("c succeeds");

    expect(stepAttempts.length).toBe(1);

    expect(stepResult).toEqual(Result.succeed("c succeeds"));
  });

  test(`ran "d fails" step and it failed, twice`, async () => {
    const jobId = nanoid();

    const job = await workflow.start(jobId, {});

    await job.waitUntilFinished();

    const stepAttempts = await job.getStepAttempts("d fails");

    const stepResult = await job.getStepResult("d fails");

    expect(stepAttempts.length).toBe(2);

    expect(stepResult).toEqual(
      Result.fail({
        failedReason: "D failed!",
        stack: expect.any(String),
      })
    );
  });

  test(`ran "e succeeds" step`, async () => {
    const jobId = nanoid();

    const job = await workflow.start(jobId, {});

    await job.waitUntilFinished();

    const stepAttempts = await job.getStepAttempts("e succeeds");

    const stepResult = await job.getStepResult("e succeeds");

    expect(stepAttempts.length).toBe(1);

    expect(stepResult).toEqual(
      Result.succeed({
        errMessage: "D failed!",
      })
    );
  });
});
