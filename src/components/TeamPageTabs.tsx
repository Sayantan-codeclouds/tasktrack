"use client";

import { useState } from "react";
import TeamsView from "./TeamsView";
import TeamView from "./TeamView";

type Tab = "teams" | "people";

export default function TeamPageTabs({ initialTab, botUsername }: { initialTab: Tab; botUsername: string | null }) {
  const [tab, setTab] = useState<Tab>(initialTab);

  function choose(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <div className="flex rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Team sections">
          {(
            [
              ["teams", "Teams"],
              ["people", "People & roles"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => choose(id)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === id ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "teams" ? <TeamsView botUsername={botUsername} /> : <TeamView />}
    </div>
  );
}
