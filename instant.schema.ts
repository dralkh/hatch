import { i } from "@instantdb/react";

const schema = i.schema({
  entities: {
    endlessScores: i.entity({
      name: i.string(),
      score: i.number().indexed(),
      rooms: i.number().indexed(),
      cleansed: i.number(),
      elapsedMs: i.number(),
      seed: i.number(),
      difficulty: i.string().indexed(),
      petName: i.string(),
      gameVersion: i.number(),
      runId: i.string().unique().indexed(),
    }),
  },
});

export type AppSchema = typeof schema;
export default schema;
