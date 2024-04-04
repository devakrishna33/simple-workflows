import { createClient } from "redis";
import { REDIS_CONFIG } from "./constants";

export const redisClient = createClient({
  url: `redis://${REDIS_CONFIG.host}`,
  password: REDIS_CONFIG.password,
});

redisClient.on("error", (err) => console.log("Redis Client Error", err));

await redisClient.connect();
