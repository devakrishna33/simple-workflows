import { Worker } from "bullmq";
import { z } from "zod";

export const wait = async (duration: number) => {
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
};

export const gracefullyShutdownWorkerOnProcessExit = async (worker: Worker) => {
  const gracefulShutdown = async () => {
    await worker.close();
    // Other asynchronous closings
    process.exit(0);
  };

  process.on("SIGINT", () => gracefulShutdown());

  process.on("SIGTERM", () => gracefulShutdown());
};

export const errorSchema = z.object({
  message: z.string(),
  stack: z.any(),
});
