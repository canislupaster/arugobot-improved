import type { HtmlEscapedString } from "hono/utils/html";

import type { GlobalOverview, TournamentSummary } from "../services/website.js";

type GuildCard = {
  id: string;
  name: string;
  linkedUsers: number;
  activeChallenges: number;
  completedChallenges: number;
  lastChallengeAt: string | null;
};

type LeaderboardRow = {
  label: string;
  value: number;
};

type RosterRow = {
  userId: string;
  handle: string;
  rating: number;
};

type ActivityView = {
  windowLabel: string;
  completedChallenges: number;
  participantCount: number;
  uniqueParticipants: number;
  solvedCount: number;
  topSolvers: LeaderboardRow[];
};

type ContestActivityView = {
  lookbackDays: number;
  contestCount: number;
  participantCount: number;
  recentContests: Array<{
    contestId: number;
    contestName: string;
    ratingUpdateTimeSeconds: number;
    scope: "official" | "gym";
  }>;
  byScope: {
    official: { contestCount: number; participantCount: number; lastContestAt: number | null };
    gym: { contestCount: number; participantCount: number; lastContestAt: number | null };
  };
};

type GuildView = {
  id: string;
  name: string;
  stats: {
    userCount: number;
    totalChallenges: number;
    avgRating: number | null;
    topRating: number | null;
  };
  ratingLeaderboard: LeaderboardRow[];
  solveLeaderboard: LeaderboardRow[];
  roster: RosterRow[];
  activity: ActivityView;
  contestActivity: ContestActivityView;
  tournaments: TournamentSummary[];
};

export type HomeViewModel = {
  generatedAt: string;
  global: GlobalOverview;
  guilds: GuildCard[];
};

export type GuildViewModel = {
  generatedAt: string;
  guild: GuildView;
};

export type StatusViewModel = {
  generatedAt: string;
  cacheEntries: Array<{
    label: string;
    lastFetched: string | null;
    ageSeconds: number | null;
  }>;
};

type ViewResult = HtmlEscapedString | Promise<HtmlEscapedString>;

const numberFormatter = new Intl.NumberFormat("en-US");
const defaultDescription =
  "ArugoBot keeps Codeforces practice on track with challenges, tournaments, reminders, and stats.";

function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "N/A";
  }
  return numberFormatter.format(value);
}

function formatTimestamp(iso: string | null): string {
  if (!iso) {
    return "N/A";
  }
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return "N/A";
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

function formatUnixTimestamp(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) {
    return "N/A";
  }
  return formatTimestamp(new Date(seconds * 1000).toISOString());
}

function formatTournamentCount(tournament: TournamentSummary): string {
  if (tournament.format === "arena") {
    const count = tournament.arenaProblemCount ?? tournament.roundCount;
    return `${formatNumber(count)} problems`;
  }
  return `${formatNumber(tournament.roundCount)} rounds`;
}

function formatArenaEndsAt(tournament: TournamentSummary): string | null {
  if (tournament.format !== "arena") {
    return null;
  }
  if (!tournament.arenaEndsAt) {
    return null;
  }
  const label = tournament.status === "active" ? "Ends" : "Ended";
  return `${label} ${formatUnixTimestamp(tournament.arenaEndsAt)}`;
}

function formatAgeSeconds(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) {
    return "N/A";
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  return `${hours}h ${minutes % 60}m`;
}

function StatCard(props: { label: string; value: string; hint?: string }): ViewResult {
  return (
    <div class="card stat">
      <div class="label">{props.label}</div>
      <div class="value">{props.value}</div>
      {props.hint ? <div class="hint">{props.hint}</div> : null}
    </div>
  );
}

function SectionHeader(props: { title: string; subtitle?: string }): ViewResult {
  return (
    <div class="section-header">
      <h2>{props.title}</h2>
      {props.subtitle ? <p>{props.subtitle}</p> : null}
    </div>
  );
}

function Layout(props: {
  title: string;
  description?: string;
  children: ViewResult | ViewResult[];
}): ViewResult {
  const description = props.description ?? defaultDescription;
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={description} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={props.title} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content="/static/og.svg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="theme-color" content="#0b1b24" />
        <title>{props.title}</title>
        <link rel="stylesheet" href="/static/styles.css" />
        <link rel="icon" href="/static/brand-icon.png" type="image/png" />
      </head>
      <body>
        <div class="page">
          <header class="site-header">
            <a class="brand" href="/">
              <div class="mark" aria-hidden="true" />
              <div>
                <div class="brand-title">ArugoBot</div>
                <div class="brand-subtitle">Codeforces practice HQ</div>
              </div>
            </a>
            <nav class="nav">
              <a href="/">Overview</a>
              <a href="/status">Status</a>
              <a href="https://codeforces.com" rel="noreferrer">
                Codeforces
              </a>
            </nav>
          </header>
          <main>{props.children}</main>
          <footer class="site-footer">
            <span>ArugoBot web console</span>
          </footer>
        </div>
      </body>
    </html>
  );
}

export function renderHomePage(model: HomeViewModel): ViewResult {
  return (
    <Layout
      title="ArugoBot | Overview"
      description="Global stats, guild leaderboards, and a live view of Codeforces practice across Discord."
    >
      <section class="hero">
        <div>
          <h1>Global snapshot</h1>
          <p>
            Live stats from active guilds, challenges, and tournaments. Last refresh:{" "}
            {formatTimestamp(model.generatedAt)}
          </p>
        </div>
        <div class="hero-glow" aria-hidden="true" />
      </section>

      <section class="section">
        <div class="section-header">
          <h2>What ArugoBot delivers</h2>
          <p>Competitive programming flows, summarized in one command surface.</p>
        </div>
        <div class="feature-grid">
          <div class="card feature-card">
            <div class="eyebrow">Challenges</div>
            <h3>Head-to-head sprints</h3>
            <p>
              Spin up problem duels with custom ranges, tags, and open lobbies that keep your server
              engaged.
            </p>
            <div class="tags">
              <span class="tag">/challenge random</span>
              <span class="tag">/challenge problem</span>
            </div>
          </div>
          <div class="card feature-card">
            <div class="eyebrow">Tournaments</div>
            <h3>Structured multi-round play</h3>
            <p>
              Swiss and elimination brackets with automatic recaps so every round ends with a story.
            </p>
            <div class="tags">
              <span class="tag">/tournament create</span>
              <span class="tag">/tournamentrecaps set</span>
            </div>
          </div>
          <div class="card feature-card">
            <div class="eyebrow">Practice</div>
            <h3>Personalized problem picks</h3>
            <p>
              One-click practice suggestions based on handles, rating bands, and tags, plus
              reminders to keep momentum.
            </p>
            <div class="tags">
              <span class="tag">/practice</span>
              <span class="tag">/practicereminders set</span>
            </div>
          </div>
          <div class="card feature-card">
            <div class="eyebrow">Contests</div>
            <h3>Contest intelligence</h3>
            <p>
              Track upcoming contests, review rating changes, and keep the server aligned with
              activity snapshots.
            </p>
            <div class="tags">
              <span class="tag">/contests</span>
              <span class="tag">/contestchanges</span>
            </div>
          </div>
        </div>
      </section>

      <section class="grid stats-grid">
        <StatCard label="Guilds with linked users" value={formatNumber(model.global.guildCount)} />
        <StatCard label="Linked users" value={formatNumber(model.global.linkedUsers)} />
        <StatCard label="Active challenges" value={formatNumber(model.global.activeChallenges)} />
        <StatCard
          label="Completed challenges"
          value={formatNumber(model.global.completedChallenges)}
          hint={`Total: ${formatNumber(model.global.totalChallenges)}`}
        />
        <StatCard label="Active tournaments" value={formatNumber(model.global.activeTournaments)} />
        <StatCard
          label="Completed tournaments"
          value={formatNumber(model.global.completedTournaments)}
          hint={`Total: ${formatNumber(model.global.totalTournaments)}`}
        />
        <StatCard
          label="Last challenge activity"
          value={formatTimestamp(model.global.lastChallengeAt)}
        />
        <StatCard
          label="Last tournament activity"
          value={formatTimestamp(model.global.lastTournamentAt)}
        />
        <StatCard
          label={`Official contests (last ${model.global.contestActivity.lookbackDays}d)`}
          value={formatNumber(model.global.contestActivity.byScope.official.contestCount)}
        />
        <StatCard
          label="Official participants"
          value={formatNumber(model.global.contestActivity.byScope.official.participantCount)}
        />
        <StatCard
          label="Last official contest update"
          value={formatUnixTimestamp(model.global.contestActivity.byScope.official.lastContestAt)}
        />
        <StatCard
          label={`Gym contests (last ${model.global.contestActivity.lookbackDays}d)`}
          value={formatNumber(model.global.contestActivity.byScope.gym.contestCount)}
        />
        <StatCard
          label="Gym participants"
          value={formatNumber(model.global.contestActivity.byScope.gym.participantCount)}
        />
        <StatCard
          label="Last gym contest update"
          value={formatUnixTimestamp(model.global.contestActivity.byScope.gym.lastContestAt)}
        />
      </section>

      <section class="section">
        <div class="card callout">
          <div>
            <div class="eyebrow">Get started</div>
            <h3>Invite, link, compete</h3>
            <p>
              Add ArugoBot to your Discord server, link handles with <strong>/register</strong>,
              then start a challenge or tournament in minutes.
            </p>
          </div>
          <div class="callout-actions">
            <a class="button" href="https://codeforces.com" rel="noreferrer">
              Visit Codeforces
            </a>
            <a class="button ghost" href="/status">
              View cache status
            </a>
          </div>
        </div>
      </section>

      <section class="section">
        <SectionHeader
          title="Guild leaderboards"
          subtitle="Top servers by completed challenges and linked users."
        />
        <div class="card table-card">
          <table>
            <thead>
              <tr>
                <th>Guild</th>
                <th>Linked users</th>
                <th>Active</th>
                <th>Completed</th>
                <th>Last challenge</th>
              </tr>
            </thead>
            <tbody>
              {model.guilds.length === 0 ? (
                <tr>
                  <td colSpan={5}>No guilds have linked users yet.</td>
                </tr>
              ) : (
                model.guilds.map((guild) => (
                  <tr>
                    <td>
                      <a href={`/guilds/${guild.id}`}>{guild.name}</a>
                      <div class="muted">{guild.id}</div>
                    </td>
                    <td>{formatNumber(guild.linkedUsers)}</td>
                    <td>{formatNumber(guild.activeChallenges)}</td>
                    <td>{formatNumber(guild.completedChallenges)}</td>
                    <td>{formatTimestamp(guild.lastChallengeAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </Layout>
  );
}

export function renderGuildPage(model: GuildViewModel): ViewResult {
  const guild = model.guild;
  return (
    <Layout
      title={`ArugoBot | ${guild.name}`}
      description={`Live leaderboard and activity summary for ${guild.name}.`}
    >
      <section class="hero compact">
        <div>
          <h1>{guild.name}</h1>
          <p>
            Guild ID: {guild.id} • Snapshot generated {formatTimestamp(model.generatedAt)}
          </p>
        </div>
        <div class="hero-glow" aria-hidden="true" />
      </section>

      <section class="grid stats-grid">
        <StatCard label="Linked users" value={formatNumber(guild.stats.userCount)} />
        <StatCard label="Total challenges" value={formatNumber(guild.stats.totalChallenges)} />
        <StatCard label="Average rating" value={formatNumber(guild.stats.avgRating)} />
        <StatCard label="Top rating" value={formatNumber(guild.stats.topRating)} />
        <StatCard label="Activity window" value={guild.activity.windowLabel} />
        <StatCard
          label="Completed in window"
          value={formatNumber(guild.activity.completedChallenges)}
        />
      </section>

      <section class="section">
        <SectionHeader title="Exports" subtitle="Download leaderboards for your server." />
        <div class="export-grid">
          <a class="button" href={`/guilds/${guild.id}/exports/rating/csv`}>
            Rating CSV
          </a>
          <a class="button" href={`/guilds/${guild.id}/exports/rating/md`}>
            Rating Markdown
          </a>
          <a class="button" href={`/guilds/${guild.id}/exports/solves/csv`}>
            Solves CSV
          </a>
          <a class="button" href={`/guilds/${guild.id}/exports/solves/md`}>
            Solves Markdown
          </a>
        </div>
      </section>

      <section class="section split">
        <div class="card">
          <SectionHeader title="Rating leaderboard" subtitle="Top ratings in this guild." />
          <ol class="leaderboard">
            {guild.ratingLeaderboard.length === 0 ? (
              <li>No entries yet.</li>
            ) : (
              guild.ratingLeaderboard.map((row) => (
                <li>
                  <span>{row.label}</span>
                  <span class="pill">{formatNumber(row.value)}</span>
                </li>
              ))
            )}
          </ol>
        </div>
        <div class="card">
          <SectionHeader title="Solve leaderboard" subtitle="Completed challenges in window." />
          <ol class="leaderboard">
            {guild.solveLeaderboard.length === 0 ? (
              <li>No solves yet.</li>
            ) : (
              guild.solveLeaderboard.map((row) => (
                <li>
                  <span>{row.label}</span>
                  <span class="pill">{formatNumber(row.value)}</span>
                </li>
              ))
            )}
          </ol>
        </div>
      </section>

      <section class="section split">
        <div class="card">
          <SectionHeader title="Recent activity" subtitle="Challenge outcomes in this window." />
          <div class="metrics">
            <div>
              <div class="label">Participants</div>
              <div class="value">{formatNumber(guild.activity.participantCount)}</div>
            </div>
            <div>
              <div class="label">Unique</div>
              <div class="value">{formatNumber(guild.activity.uniqueParticipants)}</div>
            </div>
            <div>
              <div class="label">Solves</div>
              <div class="value">{formatNumber(guild.activity.solvedCount)}</div>
            </div>
          </div>
          <div class="subheader">Top solvers</div>
          <ol class="leaderboard">
            {guild.activity.topSolvers.length === 0 ? (
              <li>No solves recorded.</li>
            ) : (
              guild.activity.topSolvers.map((row) => (
                <li>
                  <span>{row.label}</span>
                  <span class="pill">{formatNumber(row.value)}</span>
                </li>
              ))
            )}
          </ol>
        </div>
        <div class="card">
          <SectionHeader title="Recent tournaments" subtitle="Latest scheduled rounds." />
          <div class="stack">
            {guild.tournaments.length === 0 ? (
              <div class="muted">No tournaments recorded.</div>
            ) : (
              guild.tournaments.map((tournament) => {
                const arenaEndsAt = formatArenaEndsAt(tournament);
                return (
                  <div class="tournament-row">
                    <div>
                      <div class="title">
                        {tournament.format} • {tournament.lengthMinutes}m • {tournament.status}
                      </div>
                      <div class="muted">
                        {formatNumber(tournament.participantCount)} players •{" "}
                        {formatTournamentCount(tournament)}
                        {arenaEndsAt ? <> • {arenaEndsAt}</> : null}
                      </div>
                    </div>
                    <div class="pill">{formatTimestamp(tournament.updatedAt)}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="card">
          <SectionHeader
            title="Contest activity"
            subtitle={`Rating changes recorded in the last ${guild.contestActivity.lookbackDays} days, split by scope.`}
          />
          <div class="metrics">
            <div>
              <div class="label">Official contests</div>
              <div class="value">
                {formatNumber(guild.contestActivity.byScope.official.contestCount)}
              </div>
            </div>
            <div>
              <div class="label">Official participants</div>
              <div class="value">
                {formatNumber(guild.contestActivity.byScope.official.participantCount)}
              </div>
            </div>
            <div>
              <div class="label">Last official contest</div>
              <div class="value">
                {formatUnixTimestamp(guild.contestActivity.byScope.official.lastContestAt)}
              </div>
            </div>
            <div>
              <div class="label">Gym contests</div>
              <div class="value">
                {formatNumber(guild.contestActivity.byScope.gym.contestCount)}
              </div>
            </div>
            <div>
              <div class="label">Gym participants</div>
              <div class="value">
                {formatNumber(guild.contestActivity.byScope.gym.participantCount)}
              </div>
            </div>
            <div>
              <div class="label">Last gym contest</div>
              <div class="value">
                {formatUnixTimestamp(guild.contestActivity.byScope.gym.lastContestAt)}
              </div>
            </div>
          </div>
          <div class="subheader">Recent contests</div>
          <ol class="leaderboard">
            {guild.contestActivity.recentContests.length === 0 ? (
              <li>No recent contest data.</li>
            ) : (
              guild.contestActivity.recentContests.map((contest) => (
                <li>
                  <div>
                    <div>
                      {contest.contestName}
                      {contest.scope === "gym" ? (
                        <>
                          {" "}
                          <span class="tag">Gym</span>
                        </>
                      ) : null}
                    </div>
                    <div class="muted">#{contest.contestId}</div>
                  </div>
                  <span class="pill">{formatUnixTimestamp(contest.ratingUpdateTimeSeconds)}</span>
                </li>
              ))
            )}
          </ol>
        </div>
      </section>

      <section class="section">
        <SectionHeader title="Roster" subtitle="Linked handles, sorted by rating." />
        <div class="card table-card">
          <table>
            <thead>
              <tr>
                <th>Handle</th>
                <th>User ID</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              {guild.roster.length === 0 ? (
                <tr>
                  <td colSpan={3}>No linked handles.</td>
                </tr>
              ) : (
                guild.roster.map((row) => (
                  <tr>
                    <td>{row.handle}</td>
                    <td class="muted">{row.userId}</td>
                    <td>{formatNumber(row.rating)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </Layout>
  );
}

export function renderStatusPage(model: StatusViewModel): ViewResult {
  return (
    <Layout title="ArugoBot | Status" description="Diagnostics for Codeforces cache health.">
      <section class="hero compact">
        <div>
          <h1>Cache status</h1>
          <p>Last refresh: {formatTimestamp(model.generatedAt)}</p>
        </div>
        <div class="hero-glow" aria-hidden="true" />
      </section>

      <section class="section">
        <div class="card table-card">
          <table>
            <thead>
              <tr>
                <th>Cache</th>
                <th>Last fetched</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {model.cacheEntries.length === 0 ? (
                <tr>
                  <td colSpan={3}>No cache data available.</td>
                </tr>
              ) : (
                model.cacheEntries.map((entry) => (
                  <tr>
                    <td>{entry.label}</td>
                    <td>{formatTimestamp(entry.lastFetched)}</td>
                    <td>{formatAgeSeconds(entry.ageSeconds)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </Layout>
  );
}

export function renderNotFoundPage(message: string): ViewResult {
  return (
    <Layout title="ArugoBot | Not Found" description="Page not found.">
      <section class="hero compact">
        <div>
          <h1>Not found</h1>
          <p>{message}</p>
        </div>
        <div class="hero-glow" aria-hidden="true" />
      </section>
      <section class="section">
        <a class="button" href="/">
          Back to overview
        </a>
      </section>
    </Layout>
  );
}
