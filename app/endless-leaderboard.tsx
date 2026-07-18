"use client";

import { id } from "@instantdb/react";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import { GAME_LEVEL_VERSION, type EndlessResult, type GameDifficulty } from "./game-engine";
import { instant } from "./instant";

const NAME_KEY = "hatchframe-leaderboard-name";
const difficulties: GameDifficulty[] = ["explorer", "adventure", "expert"];

function cleanName(value: string) {
  return value.replace(/[^\p{L}\p{N} ._-]/gu, "").trim().replace(/\s+/g, " ").slice(0, 20);
}

function cleanPetName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 80) || "Unknown pet";
}

export function EndlessScoreSubmit({ result, petName }: { result: EndlessResult; petName: string }) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedRun, setSubmittedRun] = useState("");
  const runKey = `${result.seed}:${result.score}:${result.rooms}:${result.elapsedMs}`;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setName(localStorage.getItem(NAME_KEY) || ""));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || submittedRun === runKey) return;
    const displayName = cleanName(name);
    if (displayName.length < 2) {
      setStatus("Enter a name with at least two letters or numbers.");
      return;
    }
    setSubmitting(true);
    setStatus("");
    try {
      const runId = crypto.randomUUID();
      await instant.transact(instant.tx.endlessScores[id()].update({
        name: displayName,
        score: result.score,
        rooms: result.rooms,
        cleansed: result.cleansed,
        elapsedMs: result.elapsedMs,
        seed: result.seed,
        difficulty: result.difficulty,
        petName: cleanPetName(petName),
        gameVersion: GAME_LEVEL_VERSION,
        runId,
      }));
      localStorage.setItem(NAME_KEY, displayName);
      setName(displayName);
      setSubmittedRun(runKey);
      setStatus("Score submitted to the public leaderboard.");
    } catch (cause) {
      const rateLimited = typeof cause === "object" && cause !== null && "body" in cause && (cause as { body?: { type?: string } }).body?.type === "rate-limited";
      setStatus(rateLimited ? "Too many submissions from this network. Try again later." : "The score could not be submitted. Your local record is still saved.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submittedRun === runKey) return <p className="leaderboard-status score-submit-status" role="status">{status}</p>;
  return (
    <form className="score-submit score-submit-overlay" onSubmit={submit}>
      <label htmlFor="leaderboard-name"><span>Post this run as</span><input id="leaderboard-name" value={name} maxLength={20} autoComplete="nickname" onChange={(event) => setName(event.target.value)} placeholder="Player name" autoFocus /></label>
      <button type="submit" disabled={submitting}>{submitting ? "Submitting…" : "Submit score"}</button>
      {status && <p className="leaderboard-status" role="status">{status}</p>}
    </form>
  );
}

export default function EndlessLeaderboard({ activeDifficulty }: { activeDifficulty: GameDifficulty }) {
  const [difficulty, setDifficulty] = useState<GameDifficulty>(activeDifficulty);
  const [limit, setLimit] = useState(10);

  const query = useMemo(() => ({
    endlessScores: {
      $: {
        where: { difficulty },
        order: { score: "desc" as const },
        limit,
      },
    },
  }), [difficulty, limit]);
  const { data, isLoading, error } = instant.useQuery(query);

  const scores = data?.endlessScores ?? [];
  return (
    <section className="endless-leaderboard" aria-labelledby="endless-leaderboard-heading">
      <div className="leaderboard-heading">
        <div><span>Live · public · honor system</span><h4 id="endless-leaderboard-heading">Endless Patrol leaderboard</h4></div>
        <div className="leaderboard-filters" aria-label="Leaderboard difficulty">
          {difficulties.map((choice) => <button type="button" className={difficulty === choice ? "active" : ""} onClick={() => { setDifficulty(choice); setLimit(10); }} key={choice}>{choice}</button>)}
        </div>
      </div>
      <div className="leaderboard-table" role="table" aria-label={`${difficulty} Endless Patrol scores`}>
        <div className="leaderboard-row leaderboard-columns" role="row"><span role="columnheader">Rank</span><span role="columnheader">Player + pet</span><span role="columnheader">Rooms</span><span role="columnheader">Score</span></div>
        {isLoading && <div className="leaderboard-empty">Loading live scores…</div>}
        {error && <div className="leaderboard-empty">Leaderboard temporarily unavailable.</div>}
        {!isLoading && !error && !scores.length && <div className="leaderboard-empty">No {difficulty} scores yet. Set the first mark.</div>}
        {scores.map((entry, index) => (
          <div className="leaderboard-row" role="row" key={entry.id}>
            <strong role="cell">{String(index + 1).padStart(2, "0")}</strong>
            <span role="cell"><b>{entry.name}</b><small>{entry.petName}</small></span>
            <span role="cell">{entry.rooms}</span>
            <strong role="cell">{entry.score.toLocaleString()}</strong>
          </div>
        ))}
      </div>
      {!isLoading && !error && scores.length >= limit && <button type="button" className="leaderboard-more" onClick={() => setLimit((current) => current + 10)}>Show 10 more</button>}
    </section>
  );
}
