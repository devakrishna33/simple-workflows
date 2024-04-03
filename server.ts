import { createBullBoard } from "@bull-board/api";
import { ExpressAdapter } from "@bull-board/express";
import express from "express";

export const app = express();

export const serverAdapter = new ExpressAdapter();

serverAdapter.setBasePath("/admin/queues");

app.use("/admin/queues", serverAdapter.getRouter());

const port = 9000;

app.listen(port, () => {
  console.log(`Running on ${port}...`);
  console.log(`For the UI, open http://localhost:${port}/admin/queues`);
});

export const bullBoard = createBullBoard({
  queues: [],
  serverAdapter: serverAdapter,
});
