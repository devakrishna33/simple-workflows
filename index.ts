import { DelayedError, Queue, WaitingChildrenError, Worker } from "bullmq";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import dayjs from "dayjs";
import duration, { Duration } from "dayjs/plugin/duration";
import { bullBoard } from "./server";
import { Resend } from "resend";
import { nanoid } from "nanoid";
import { REDIS_CONFIG } from "./constants";

dayjs.extend(duration);

type CachedTasks = {
  [id: string]: any;
};

type WaitForEventOptions = {
  timeout?: duration.Duration;
};

type WaitForEvent = (id: string, options: WaitForEventOptions) => Promise<any>;

type Step = {
  getCachedTasks: () => CachedTasks;
  sleep: (id: string, duration: duration.Duration) => Promise<void>;
  run: (id: string, fn: () => Promise<any>) => Promise<any>;
  waitForEvent: WaitForEvent;
};

type Handler = (payload: { event: string; step: Step }) => {};

class QueueFunction {
  id: string;
  handler: Handler;

  constructor(id: string, handler: Handler) {
    this.id = id;
    this.handler = handler;
  }
}

const createFunction = (
  options: {
    id: string;
  },
  trigger: {
    event: string;
  },
  handler: (payload: { event: string; step: Step }) => {}
) => {
  return new QueueFunction(options.id, handler);
};

const sendEmail = async ({
  email,
  html,
  subject,
}: {
  email: string;
  subject: string;
  html: string;
}) => {
  const resend = new Resend(process.env.RESEND_API_KEY);

  resend.emails.send({
    from: "onboarding@resend.dev",
    to: email,
    subject,
    html,
  });
};

const helloWorldFunction = createFunction(
  {
    id: "hello-world",
  },
  {
    event: "test/hello.world",
  },
  async ({ event, step }) => {
    await step.run("send-welcome-email", () =>
      sendEmail({
        email: "demo@gmail.com",
        subject: "Welcome Email for your order",
        html: "<h1>Welcome to Resend</h1>",
      })
    );

    const order = await step.waitForEvent("wait-for-order", {
      timeout: dayjs.duration({
        seconds: 5,
      }),
    });

    if (!order) {
      await step.run("send-reminder-email", () =>
        sendEmail({
          email: "demo@gmail.com",
          subject: "Reminder Email For your Order",
          html: "<h1>Reminder for your order</h1>",
        })
      );
    }

    return {
      event,
      body: "Hello World!",
    };
  }
);

const functions = [helloWorldFunction];

const queues: Queue[] = [];

for (const func of functions) {
  queues.push(
    new Queue(func.id, {
      connection: REDIS_CONFIG,
    })
  );

  // insert the waiting queue
  queues.push(
    new Queue(`${func.id}-waiting`, {
      connection: REDIS_CONFIG,
    })
  );
}

new Worker(
  functions[0].id,
  async (job, token) => {
    if (!token) throw new Error("Token not found");

    return functions[0].handler({
      event: "test/hello.world",
      step: {
        waitForEvent: async (id: string, options: WaitForEventOptions) => {
          if (job.data.cachedTasks?.[id]?.status === "timedout") {
            return;
          }

          if (job.data.cachedTasks?.[id]?.status === "done") {
            return job.data.cachedTasks[id]?.data;
          }

          if (!job.id) throw new Error("Job ID not found");

          const childId = `${job.id}:${id}`;

          const childJob = await queues[1].getJob(childId);

          if (!childJob) {
            await queues[1].add(
              `${job.id}:${id}`,
              {},
              {
                jobId: childId,
                parent: {
                  id: job.id,
                  queue: job.queueQualifiedName,
                },
                delay:
                  options.timeout?.asMilliseconds() ??
                  dayjs
                    .duration({
                      years: 1,
                    })
                    .asMilliseconds(),
              }
            );

            await job.moveToWaitingChildren(token);

            throw new WaitingChildrenError();
          } else {
            await job.updateData({
              cachedTasks: {
                ...(job.data.cachedTasks ?? {}),
                [id]: {
                  status: childJob.returnvalue.status,
                  data: childJob.returnvalue.data,
                },
              },
            });

            return childJob.data.data;
          }
        },
        getCachedTasks: () => {
          return job.data.cachedTasks ?? {};
        },
        run: async (id: string, fn: () => Promise<any>) => {
          if (job.data.cachedTasks?.[id] === "done") {
            return job.data.cachedTasks[id];
          }

          const result = await fn();

          await job.updateData({
            cachedTasks: {
              ...(job.data.cachedTasks ?? {}),
              [id]: result || "done",
            },
          });

          return result;
        },
        sleep: async (id: string, duration: Duration) => {
          if (job.data.cachedTasks?.[id] === "done") {
            return;
          }

          await job.moveToDelayed(
            Date.now() + duration.asMilliseconds(),
            token
          );

          await job.updateData({
            cachedTasks: {
              ...(job.data.cachedTasks ?? {}),
              [id]: "done",
            },
          });

          throw new DelayedError();
        },
      },
    });
  },
  {
    connection: REDIS_CONFIG,
  }
);

new Worker(
  `${functions[0].id}-waiting`,
  async (job, token) => {
    // this job is delayed and timedout we need to update the parent job
    const parentId = job.parent?.id;

    if (!parentId) throw new Error("Parent ID not found");

    const parentJob = await queues[0].getJob(parentId);

    if (!parentJob) throw new Error("Parent Job not found");

    if (typeof job.id !== "string") throw new Error("Job ID is not a string");

    if (!job.data.data) {
      return {
        status: "timedout",
      };
    }

    return {
      status: "success",
      data: job.data.data,
    };
  },
  {
    connection: REDIS_CONFIG,
  }
);

queues.map((queue) => bullBoard.addQueue(new BullMQAdapter(queue)));

const jobId = nanoid();

await queues[0].add(
  "test/hello.world",
  {},
  {
    jobId,
  }
);

const emitEvent = async (jobId: string, event: string, data: any) => {
  const job = await queues[1].getJob(`${jobId}:${event}`);

  if (!job) {
    throw new Error("Job not found");
  }

  await job?.updateData({
    data,
  });

  await job.changeDelay(0);
};

setTimeout(() => {
  emitEvent(jobId, "wait-for-order", {
    order: {
      id: nanoid(),
    },
  });
}, 2000);
