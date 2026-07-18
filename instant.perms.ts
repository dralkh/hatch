import type { InstantRules } from "@instantdb/react";

const rules = {
  "$default": {
    allow: {
      "$default": "false",
    },
  },
  attrs: {
    allow: {
      create: "false",
    },
  },
  endlessScores: {
    allow: {
      view: "true",
      create: "validFields && validValues && validOrigin && rateLimit.submitScore.limit(request.ip)",
      update: "false",
      delete: "false",
    },
    bind: {
      validFields: "request.modifiedFields.all(field, field in ['name', 'score', 'rooms', 'cleansed', 'elapsedMs', 'seed', 'difficulty', 'petName', 'gameVersion', 'runId'])",
      validValues: "data.name.size() >= 2 && data.name.size() <= 20 && data.petName.size() >= 1 && data.petName.size() <= 80 && data.runId.size() >= 16 && data.runId.size() <= 120 && data.score >= 0 && data.score <= 1000000000 && data.rooms >= 0 && data.rooms <= 1000000 && data.cleansed >= 0 && data.cleansed <= 10000000 && data.elapsedMs >= 1000 && data.elapsedMs <= 31536000000 && data.seed >= 0 && data.seed <= 4294967295 && data.difficulty in ['explorer', 'adventure', 'expert'] && data.gameVersion == 3",
      validOrigin: "request.origin == 'https://hatch.amayx.com' || request.origin.startsWith('http://localhost:') || request.origin.startsWith('http://127.0.0.1:')",
    },
  },
  "$rateLimits": {
    submitScore: {
      limits: [
        { capacity: 5, refill: { amount: 5, period: "1 minute" } },
        { capacity: 30, refill: { amount: 30, period: "1 day" } },
      ],
    },
  },
} satisfies InstantRules;

export default rules;
