import { Job as BullMQJob, Queue, QueueEvents, Worker } from "bullmq";
import { Handler, WaitForEventOptions, Step } from "./types";
import { REDIS_CONFIG } from "./constants";
import { Duration } from "dayjs/plugin/duration";
import { errorSchema, gracefullyShutdownWorkerOnProcessExit } from "./utils";
import { redisClient } from "./redis-client";
import { Result, ResultT } from "./result";

type JobId = string;

type WorkflowId = string;

type Job<A = any, B = any, C extends string = string> = BullMQJob<A, B, C> & {
  id: JobId;
};

type CachedSteps = Record<string, ResultT<any, any> | undefined>;

export class SimpleWorkflow<InputData, ReturnValue> {
  id: WorkflowId;
  handler: Handler<ReturnValue>;
  mainQueue: Queue;
  signalsQueue: Queue;
  mainQueueEvents: QueueEvents;
  cachedSteps: CachedSteps = {};

  constructor(id: WorkflowId, handler: Handler<ReturnValue>) {
    this.id = id;
    this.handler = handler;

    this.mainQueue = new Queue(this.id, {
      connection: REDIS_CONFIG,
    });

    this.signalsQueue = new Queue(`${this.id}-events`, {
      connection: REDIS_CONFIG,
    });

    this.mainQueueEvents = new QueueEvents(this.mainQueue.name, {
      connection: REDIS_CONFIG,
    });

    this.initializeMainQueueWorker();
  }

  initializeMainQueueWorker() {
    const worker = new Worker(
      this.mainQueue.name,
      async (job, token) => {
        if (!token) throw new Error("Token not found");

        const jobId = job.id;

        if (!jobId) throw new Error("Job ID not found");

        const workflowJob = await SimpleWorkflowJob.create(jobId, this);

        return await workflowJob.handle();
      },
      {
        connection: REDIS_CONFIG,
      }
    );

    gracefullyShutdownWorkerOnProcessExit(worker);
  }

  async getJob(
    jobId: JobId
  ): Promise<Job<InputData, ReturnValue, string> | undefined> {
    return (await this.mainQueue.getJob(jobId)) as
      | Job<InputData, ReturnValue, string>
      | undefined;
  }

  async start(
    jobId: JobId,
    data: InputData,
    options: { attempts?: number } = {}
  ) {
    await this.mainQueue.add(jobId, data, {
      jobId,
      ...options,
    });

    return await SimpleWorkflowJob.create(jobId, this);
  }
}

class SimpleWorkflowJob<
  InputData,
  ReturnValue,
  Workflow extends SimpleWorkflow<InputData, ReturnValue>
> {
  jobId: JobId;
  workflow: Workflow;

  private constructor(jobId: JobId, workflow: Workflow) {
    this.jobId = jobId;
    this.workflow = workflow;
  }

  static async create<InputData, ReturnValue>(
    jobId: JobId,
    workflow: SimpleWorkflow<InputData, ReturnValue>
  ) {
    const job = new SimpleWorkflowJob(jobId, workflow);

    return job;
  }

  async getCachedSteps() {
    const rawCachedSteps = await redisClient.hGetAll(
      `tasks:${this.workflow.id}:${this.jobId}`
    );

    const cachedSteps = {} as CachedSteps;

    for (const key in rawCachedSteps) {
      cachedSteps[key] = JSON.parse(rawCachedSteps[key]);
    }

    return cachedSteps;
  }

  async getStepAttempts(stepId: string) {
    const cachedSteps = await this.getCachedSteps();

    const attempts: ResultT<any, any>[] = [];

    for (const key in cachedSteps) {
      if (key.startsWith(stepId)) {
        if (cachedSteps[key] === undefined) continue;

        const attempt = key.split(":")[1];

        attempts[Number(attempt) - 1] = cachedSteps[key];
      }
    }

    return attempts;
  }

  async getStepResult(stepId: string) {
    const attempts = await this.getStepAttempts(stepId);

    return attempts[attempts.length - 1];
  }

  async handle() {
    const cachedSteps = await this.getCachedSteps();

    const cacheStepResult = async (entry: {
      result: ResultT<any, any>;
      key: string;
      currentAttempt: number;
    }) => {
      const cacheKey = `${entry.key}:${entry.currentAttempt}`;

      cachedSteps[cacheKey] = entry.result;

      await redisClient.hSet(
        `tasks:${this.workflow.id}:${this.jobId}`,
        cacheKey,
        JSON.stringify(entry.result)
      );
    };

    const handlerResult = await this.workflow.handler({
      step: {
        waitForEvent: async (id: string, options: WaitForEventOptions) => {},
        getCachedTasks: () => {
          return {};
        },
        run: async <T>(
          stepId: string,
          fn: () => Promise<T>,
          options: Parameters<Step["run"]>[2]
        ) => {
          const maxAttempts = options?.maxAttempts ?? 1;

          let currentAttempt = 1;

          const executeFunction: () => ReturnType<typeof fn> = async () => {
            const cachedStep = cachedSteps[`${stepId}:${currentAttempt}`];

            if (cachedStep?.isFailure) {
              currentAttempt++;

              return await executeFunction();
            }

            if (cachedStep?.isSuccess) return cachedStep.value;

            try {
              const value = await fn();

              await cacheStepResult({
                key: stepId,
                result: Result.succeed(value),
                currentAttempt,
              });

              return value;
            } catch (rawError) {
              const error = errorSchema.safeParse(rawError);

              if (!error.success) {
                throw rawError;
              }

              await cacheStepResult({
                key: stepId,
                result: Result.fail({
                  failedReason: error.data.message,
                  stack: error.data.stack,
                }),
                currentAttempt,
              });

              if (currentAttempt < maxAttempts) {
                currentAttempt++;
                return await executeFunction();
              }

              throw rawError;
            }
          };

          return await executeFunction();
        },
        sleep: async (id: string, duration: Duration) => {},
      },
    });

    return handlerResult;
  }

  async waitUntilFinished() {
    try {
      const job = await this.workflow.getJob(this.jobId);

      return {
        isSuccess: true,
        result: await job?.waitUntilFinished(this.workflow.mainQueueEvents),
      } as {
        isSuccess: true;
        result: ReturnValue;
      };
    } catch (rawError) {
      const error = errorSchema.safeParse(rawError);

      if (!error.success) {
        // we  can't handle this kind of error
        throw rawError;
      }

      return {
        isSuccess: false as const,
        failedReason: error.data.message ?? "Unknown error",
        stacktrace: error.data.stack ?? "",
      } as {
        isSuccess: false;
        failedReason: string;
        stacktrace: string;
      };
    }
  }

  async getResult(): Promise<
    | {
        isSuccess: true;
        result: ReturnValue;
      }
    | {
        isSuccess: false;
        failedReason: string;
        stacktrace: string;
      }
  > {
    return await this.waitUntilFinished();
  }
}
