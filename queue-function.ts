import { Handler } from "./types";

export class QueueFunction {
  id: string;
  handler: Handler;

  constructor(id: string, handler: Handler) {
    this.id = id;
    this.handler = handler;
  }
}
