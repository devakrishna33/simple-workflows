import duration from "dayjs/plugin/duration";

export type CachedTasks = {
  [id: string]: any;
};

export type WaitForEventOptions = {
  timeout?: duration.Duration;
};

export type WaitForEvent = (
  id: string,
  options: WaitForEventOptions
) => Promise<any>;

export type Step = {
  getCachedTasks: () => CachedTasks;
  sleep: (id: string, duration: duration.Duration) => Promise<void>;
  run: (id: string, fn: () => Promise<any>) => Promise<any>;
  waitForEvent: WaitForEvent;
};

export type Handler = (payload: { event: string; step: Step }) => {};
