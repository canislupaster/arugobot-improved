import type { HtmlEscapedString } from "hono/utils/html";

import type { TournamentRecap } from "../services/tournaments.js";
import type {
  GlobalOverview,
  TournamentSummary,
  UpcomingContestsOverview,
} from "../services/website.js";
import { buildProblemLink } from "../utils/contestProblems.js";
import { buildContestUrl } from "../utils/contestUrl.js";
import { formatTime } from "../utils/rating.js";
import { formatStreakEmojis } from "../utils/streaks.js";
import { capitalize } from "../utils/text.js";
import { formatRatingRanges, formatTags } from "../utils/tournamentRecap.js";

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

type LeaderboardFormatter = (value: number) => string;

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
  currentStreakLeaderboard: LeaderboardRow[];
  longestStreakLeaderboard: LeaderboardRow[];
  roster: RosterRow[];
  activity: ActivityView;
  contestActivity: ContestActivityView;
  tournaments: TournamentSummary[];
};

export type HomeViewModel = {
  generatedAt: string;
  global: GlobalOverview;
  upcomingContests: UpcomingContestsOverview;
  guilds: GuildCard[];
};

export type GuildViewModel = {
  generatedAt: string;
  guild: GuildView;
};

export type TournamentViewModel = {
  generatedAt: string;
  guild: { id: string; name: string };
  recap: TournamentRecap;
};

export type StatusViewModel = {
  generatedAt: string;
  cacheEntries: Array<{
    label: string;
    lastFetched: string | null;
    ageSeconds: number | null;
  }>;
  tokenUsage: GlobalOverview["tokenUsage"];
  dbOk: boolean;
  status: "ok" | "degraded";
  codeforces: {
    lastSuccessAt: string | null;
    lastError: { message: string; endpoint: string; timestamp: string } | null;
  };
};

type InlineText = HtmlEscapedString | string | Promise<HtmlEscapedString>;
type ViewResult = HtmlEscapedString | Promise<HtmlEscapedString>;
type UpcomingContestEntry = UpcomingContestsOverview["official"][number];

const numberFormatter = new Intl.NumberFormat("en-US");
const defaultDescription =
  "ArugoBot keeps Codeforces practice on track with challenges, tournaments, reminders, and stats.";
const BIBTEX_CITATION = `@misc{jegham2025hungryaibenchmarkingenergy,
  title={How Hungry is AI? Benchmarking Energy, Water, and Carbon Footprint of LLM Inference},
  author={Nidhal Jegham and Marwan Abdelatti and Chan Young Koh and Lassad Elmoubarki and Abdeltawab Hendawi},
  year={2025},
  eprint={2505.09598},
  archivePrefix={arXiv},
  primaryClass={cs.CY},
  url={https://arxiv.org/abs/2505.09598},
}`;

function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "N/A";
  }
  return numberFormatter.format(value);
}

function formatTokenValue(value: number | null): string {
  if (value === null) {
    return "Disabled";
  }
  return formatNumber(value);
}

function formatImpactValue(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  return formatNumber(value);
}

function formatStreakValue(value: number): string {
  const emojis = formatStreakEmojis(value);
  return emojis ? `${formatNumber(value)} ${emojis}` : formatNumber(value);
}

function formatHealthStatus(status: "ok" | "degraded"): string {
  return status === "ok" ? "OK" : "Degraded";
}

function renderContestRow(contest: UpcomingContestEntry) {
  const contestUrl = buildContestUrl({ id: contest.id, isGym: contest.isGym });
  return (
    <a class="tournament-row" href={contestUrl}>
      <div>
        <div class="title">{contest.name}</div>
        <div class="muted">
          Starts {renderLocalTimeFromUnix(contest.startTimeSeconds)} •{" "}
          {formatDurationSeconds(contest.durationSeconds)}
        </div>
      </div>
      <div class="pill">#{contest.id}</div>
    </a>
  );
}

function renderUpcomingContestCard(
  title: string,
  contests: UpcomingContestEntry[],
  lastRefreshAt: string | null,
  emptyLabel: string
): ViewResult {
  const subtitle = lastRefreshAt ? (
    <>
      Last refresh {renderLocalTime(lastRefreshAt)}
    </>
  ) : (
    "Upcoming contests from the cached contest list."
  );

  return (
    <div class="card">
      <SectionHeader title={title} subtitle={subtitle} />
      <div class="stack">
        {contests.length === 0 ? (
          <div class="muted">{emptyLabel}</div>
        ) : (
          contests.map((contest) => renderContestRow(contest))
        )}
      </div>
    </div>
  );
}

function renderLeaderboard(
  rows: LeaderboardRow[],
  emptyLabel: string,
  formatValue: LeaderboardFormatter = formatNumber
) {
  return (
    <ol class="leaderboard">
      {rows.length === 0 ? (
        <li>{emptyLabel}</li>
      ) : (
        rows.map((row) => (
          <li>
            <span>{row.label}</span>
            <span class="pill">{formatValue(row.value)}</span>
          </li>
        ))
      )}
    </ol>
  );
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

function renderLocalTime(iso: string | null): ViewResult {
  if (!iso) {
    return <span>N/A</span>;
  }
  return (
    <span class="js-local-time" data-iso={iso}>
      {formatTimestamp(iso)}
    </span>
  );
}

function renderLocalTimeFromUnix(seconds: number | null | undefined): ViewResult {
  if (!seconds || !Number.isFinite(seconds)) {
    return <span>N/A</span>;
  }
  return renderLocalTime(new Date(seconds * 1000).toISOString());
}

function formatTournamentCount(tournament: TournamentSummary): string {
  if (tournament.format === "arena") {
    const count = tournament.arenaProblemCount ?? tournament.roundCount;
    return `${formatNumber(count)} problems`;
  }
  return `${formatNumber(tournament.roundCount)} rounds`;
}

function formatArenaEndsAt(tournament: TournamentSummary): ViewResult | null {
  if (tournament.format !== "arena") {
    return null;
  }
  if (!tournament.arenaEndsAt) {
    return null;
  }
  const label = tournament.status === "active" ? "Ends" : "Ended";
  return (
    <>
      {label} {renderLocalTimeFromUnix(tournament.arenaEndsAt)}
    </>
  );
}

function formatParticipantLabel(
  userId: string,
  handles: Record<string, string | null>
): string {
  const handle = handles[userId];
  return handle ? `${handle} (${userId})` : userId;
}

function formatStandingsDetail(
  entry: TournamentRecap["standings"][number],
  format: TournamentRecap["entry"]["format"]
): string {
  if (format === "arena") {
    const timeLabel = entry.score > 0 ? ` • ${formatTime(entry.tiebreak)}` : "";
    return `${entry.score} solves${timeLabel}`;
  }
  const record = `${entry.wins}-${entry.losses}-${entry.draws}`;
  const tiebreakLabel = format === "swiss" ? ` • TB ${entry.tiebreak.toFixed(1)}` : "";
  return `${entry.score} pts (${record})${tiebreakLabel}`;
}

function formatMatchSummary(
  match: TournamentRecap["rounds"][number]["matches"][number],
  handles: Record<string, string | null>
): { title: string; subtitle: string; status: string } {
  const player1 = formatParticipantLabel(match.player1Id, handles);
  if (!match.player2Id) {
    return {
      title: `Match ${match.matchNumber}`,
      subtitle: `${player1} has a bye`,
      status: "bye",
    };
  }
  const player2 = formatParticipantLabel(match.player2Id, handles);
  const winner = match.winnerId
    ? formatParticipantLabel(match.winnerId, handles)
    : match.isDraw
      ? "Draw"
      : "No winner";
  const status = match.status === "completed" ? "completed" : match.status;
  return {
    title: `Match ${match.matchNumber}`,
    subtitle: `${player1} vs ${player2} • Winner: ${winner}`,
    status,
  };
}

function formatProblemLabel(problem: TournamentRecap["rounds"][number]["problem"]) {
  const problemId = `${problem.contestId}${problem.index}`;
  const url = buildProblemLink(problem);
  const rating = problem.rating ? ` (${problem.rating})` : "";
  return { problemId, url, label: `${problemId} • ${problem.name}${rating}` };
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

function formatDurationSeconds(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) {
    return "N/A";
  }
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

function StatCard(props: { label: string; value: ViewResult; hint?: InlineText }): ViewResult {
  return (
    <div class="card stat">
      <div class="label">{props.label}</div>
      <div class="value">{props.value}</div>
      {props.hint ? <div class="hint">{props.hint}</div> : null}
    </div>
  );
}

function SectionHeader(props: { title: string; subtitle?: InlineText }): ViewResult {
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
        <script src="/static/local-time.js" defer></script>
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
            {renderLocalTime(model.generatedAt)}
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
        <StatCard
          label="Guilds with linked users"
          value={<span>{formatNumber(model.global.guildCount)}</span>}
        />
        <StatCard
          label="Linked users"
          value={<span>{formatNumber(model.global.linkedUsers)}</span>}
        />
        <StatCard
          label="Active challenges"
          value={<span>{formatNumber(model.global.activeChallenges)}</span>}
        />
        <StatCard
          label="Completed challenges"
          value={<span>{formatNumber(model.global.completedChallenges)}</span>}
          hint={`Total: ${formatNumber(model.global.totalChallenges)}`}
        />
        <StatCard
          label="Active tournaments"
          value={<span>{formatNumber(model.global.activeTournaments)}</span>}
        />
        <StatCard
          label="Completed tournaments"
          value={<span>{formatNumber(model.global.completedTournaments)}</span>}
          hint={`Total: ${formatNumber(model.global.totalTournaments)}`}
        />
        <StatCard
          label="Last challenge activity"
          value={renderLocalTime(model.global.lastChallengeAt)}
        />
        <StatCard
          label="Last tournament activity"
          value={renderLocalTime(model.global.lastTournamentAt)}
        />
        <StatCard
          label={`Official contests (last ${model.global.contestActivity.lookbackDays}d)`}
          value={
            <span>{formatNumber(model.global.contestActivity.byScope.official.contestCount)}</span>
          }
        />
        <StatCard
          label="Official participants"
          value={
            <span>
              {formatNumber(model.global.contestActivity.byScope.official.participantCount)}
            </span>
          }
        />
        <StatCard
          label="Last official contest update"
          value={renderLocalTimeFromUnix(
            model.global.contestActivity.byScope.official.lastContestAt
          )}
        />
        <StatCard
          label={`Gym contests (last ${model.global.contestActivity.lookbackDays}d)`}
          value={<span>{formatNumber(model.global.contestActivity.byScope.gym.contestCount)}</span>}
        />
        <StatCard
          label="Gym participants"
          value={
            <span>{formatNumber(model.global.contestActivity.byScope.gym.participantCount)}</span>
          }
        />
        <StatCard
          label="Last gym contest update"
          value={renderLocalTimeFromUnix(model.global.contestActivity.byScope.gym.lastContestAt)}
        />
        <StatCard
          label="Rating alert guilds"
          value={<span>{formatNumber(model.global.contestRatingAlerts.guildCount)}</span>}
          hint={`Subscriptions: ${formatNumber(
            model.global.contestRatingAlerts.subscriptionCount
          )}`}
        />
        <StatCard
          label="Last rating alert"
          value={renderLocalTime(model.global.contestRatingAlerts.lastNotifiedAt)}
        />
        <StatCard
          label="Rating change cache age"
          value={<span>{formatAgeSeconds(model.global.contestRatingAlerts.cacheAgeSeconds)}</span>}
          hint={
            <>
              Last fetched:{" "}
              {renderLocalTime(model.global.contestRatingAlerts.cacheLastFetched)}
            </>
          }
        />
        <StatCard
          label="Token total"
          value={<span>{formatTokenValue(model.global.tokenUsage?.totalTokens ?? null)}</span>}
        />
        <StatCard
          label="Energy estimate (kWh)"
          value={
            <span>{formatImpactValue(model.global.tokenUsage?.impact.energyKwh ?? null)}</span>
          }
        />
        <StatCard
          label="Water estimate (L)"
          value={
            <span>{formatImpactValue(model.global.tokenUsage?.impact.waterLiters ?? null)}</span>
          }
        />
        <StatCard
          label="Carbon estimate (kg CO2e)"
          value={
            <span>{formatImpactValue(model.global.tokenUsage?.impact.carbonKg ?? null)}</span>
          }
        />
      </section>

      <section class="section split">
        {renderUpcomingContestCard(
          "Upcoming official contests",
          model.upcomingContests.official,
          model.upcomingContests.lastRefreshAt,
          "No upcoming official contests cached."
        )}
        {renderUpcomingContestCard(
          "Upcoming gym contests",
          model.upcomingContests.gym,
          model.upcomingContests.lastRefreshAt,
          "No upcoming gym contests cached."
        )}
      </section>

      <section class="section">
        <div class="card callout">
          <div>
            <div class="eyebrow">Community</div>
            <h3>Join Purdue CPU</h3>
            <p>
              Try ArugoBot in the Purdue CPU Discord, link handles with{" "}
              <strong>/register</strong>, and start a challenge or tournament.
            </p>
          </div>
          <div class="callout-actions">
            <a class="button" href="https://purduecpu.com/discord" rel="noreferrer">
              Join CPU Discord
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
                    <td>{renderLocalTime(guild.lastChallengeAt)}</td>
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
            Guild ID: {guild.id} • Snapshot generated {renderLocalTime(model.generatedAt)}
          </p>
        </div>
        <div class="hero-glow" aria-hidden="true" />
      </section>

      <section class="grid stats-grid">
        <StatCard label="Linked users" value={<span>{formatNumber(guild.stats.userCount)}</span>} />
        <StatCard
          label="Total challenges"
          value={<span>{formatNumber(guild.stats.totalChallenges)}</span>}
        />
        <StatCard
          label="Average rating"
          value={<span>{formatNumber(guild.stats.avgRating)}</span>}
        />
        <StatCard label="Top rating" value={<span>{formatNumber(guild.stats.topRating)}</span>} />
        <StatCard label="Activity window" value={<span>{guild.activity.windowLabel}</span>} />
        <StatCard
          label="Completed in window"
          value={<span>{formatNumber(guild.activity.completedChallenges)}</span>}
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
          {renderLeaderboard(guild.ratingLeaderboard, "No entries yet.")}
        </div>
        <div class="card">
          <SectionHeader title="Solve leaderboard" subtitle="Completed challenges in window." />
          {renderLeaderboard(guild.solveLeaderboard, "No solves yet.")}
        </div>
      </section>

      <section class="section split">
        <div class="card">
          <SectionHeader title="Current streaks" subtitle="Challenge streaks ending today." />
          {renderLeaderboard(guild.currentStreakLeaderboard, "No streaks yet.", formatStreakValue)}
        </div>
        <div class="card">
          <SectionHeader title="Longest streaks" subtitle="Best challenge streaks on record." />
          {renderLeaderboard(guild.longestStreakLeaderboard, "No streaks yet.", formatStreakValue)}
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
          {renderLeaderboard(guild.activity.topSolvers, "No solves recorded.")}
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
                  <a
                    class="tournament-row"
                    href={`/guilds/${guild.id}/tournaments/${tournament.id}`}
                  >
                    <div>
                      <div class="title">
                        {capitalize(tournament.format)} • {tournament.lengthMinutes}m •{" "}
                        {tournament.status}
                      </div>
                      <div class="muted">
                        {formatNumber(tournament.participantCount)} players •{" "}
                        {formatTournamentCount(tournament)}
                        {arenaEndsAt ? <> • {arenaEndsAt}</> : null}
                      </div>
                    </div>
                    <div class="pill">{renderLocalTime(tournament.updatedAt)}</div>
                  </a>
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
                {renderLocalTimeFromUnix(guild.contestActivity.byScope.official.lastContestAt)}
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
                {renderLocalTimeFromUnix(guild.contestActivity.byScope.gym.lastContestAt)}
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
                  <span class="pill">
                    {renderLocalTimeFromUnix(contest.ratingUpdateTimeSeconds)}
                  </span>
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

export function renderTournamentPage(model: TournamentViewModel): ViewResult {
  const recap = model.recap;
  const formatLabel = capitalize(recap.entry.format);
  const statusLabel = recap.entry.status === "completed" ? "Completed" : "Cancelled";
  const winnerLabel = recap.entry.winnerId
    ? formatParticipantLabel(recap.entry.winnerId, recap.participantHandles)
    : "None";
  const ratingRanges = formatRatingRanges(recap.entry.ratingRanges);
  const tags = formatTags(recap.entry.tags);
  const hostLabel = formatParticipantLabel(recap.hostUserId, recap.participantHandles);

  return (
    <Layout
      title={`ArugoBot | Tournament ${recap.entry.id}`}
      description={`Tournament recap for ${model.guild.name}.`}
    >
      <section class="hero compact">
        <div>
          <h1>{model.guild.name}</h1>
          <p>
            {formatLabel} tournament recap • Last refresh {renderLocalTime(model.generatedAt)}
          </p>
        </div>
        <div class="hero-glow" aria-hidden="true" />
      </section>

      <section class="section split">
        <div class="card">
          <SectionHeader title="Tournament summary" subtitle={`Status: ${statusLabel}`} />
          <div class="metrics">
            <div>
              <div class="label">Participants</div>
              <div class="value">{formatNumber(recap.entry.participantCount)}</div>
            </div>
            <div>
              <div class="label">Rounds</div>
              <div class="value">{formatNumber(recap.entry.roundCount)}</div>
            </div>
            <div>
              <div class="label">Length</div>
              <div class="value">{formatNumber(recap.entry.lengthMinutes)}m</div>
            </div>
          </div>
          <div class="subheader">Winner</div>
          <div>{winnerLabel}</div>
          <div class="subheader">Host</div>
          <div>{hostLabel}</div>
          <div class="subheader">Channel</div>
          <div>{recap.channelId}</div>
          <div class="subheader">Ranges</div>
          <div>{ratingRanges}</div>
          <div class="subheader">Tags</div>
          <div>{tags}</div>
          <div class="subheader">Updated</div>
          <div>{renderLocalTime(recap.entry.updatedAt)}</div>
          <div class="subheader">Guild</div>
          <div>
            <a href={`/guilds/${model.guild.id}`}>Back to {model.guild.name}</a>
          </div>
        </div>
        <div class="card">
          <SectionHeader title="Standings" subtitle="Final table and seed order." />
          {recap.standings.length === 0 ? (
            <div class="muted">No standings recorded.</div>
          ) : (
            <div class="stack">
              {recap.standings.map((entry, index) => {
                const label = formatParticipantLabel(entry.userId, recap.participantHandles);
                const detail = formatStandingsDetail(entry, recap.entry.format);
                const status = entry.eliminated ? "Eliminated" : `Seed ${entry.seed}`;
                return (
                  <div class="tournament-row">
                    <div>
                      <div class="title">
                        #{index + 1} {label}
                      </div>
                      <div class="muted">{detail}</div>
                    </div>
                    <div class="pill">{status}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {recap.entry.format === "arena" ? (
        <section class="section">
          <div class="card">
            <SectionHeader title="Arena problems" subtitle="Ordered by rating." />
            <div class="stack">
              {recap.arenaProblems?.length ? (
                recap.arenaProblems.map((problem) => {
                  const label = formatProblemLabel(problem);
                  return (
                    <div class="tournament-row">
                      <div>
                        <div class="title">
                          <a href={label.url} rel="noreferrer">
                            {label.problemId}
                          </a>
                        </div>
                        <div class="muted">{label.label}</div>
                      </div>
                      {problem.rating ? <div class="pill">{problem.rating}</div> : null}
                    </div>
                  );
                })
              ) : (
                <div class="muted">No arena problems recorded.</div>
              )}
            </div>
          </div>
        </section>
      ) : (
        <></>
      )}

      {recap.entry.format !== "arena" ? (
        <section class="section">
          <SectionHeader title="Rounds" subtitle="Problems and match results." />
          <div class="stack">
            {recap.rounds.length === 0 ? (
              <div class="card">
                <div class="muted">No rounds recorded.</div>
              </div>
            ) : (
              recap.rounds.map((round) => {
                const problem = formatProblemLabel(round.problem);
                return (
                  <div class="card">
                    <SectionHeader
                      title={`Round ${round.roundNumber}`}
                      subtitle={`Status: ${round.status}`}
                    />
                    <div class="subheader">Problem</div>
                    <div>
                      <a href={problem.url} rel="noreferrer">
                        {problem.label}
                      </a>
                    </div>
                    <div class="subheader">Matches</div>
                    {round.matches.length === 0 ? (
                      <div class="muted">No matches recorded.</div>
                    ) : (
                      <div class="stack">
                        {round.matches.map((match) => {
                          const summary = formatMatchSummary(match, recap.participantHandles);
                          return (
                            <div class="tournament-row">
                              <div>
                                <div class="title">{summary.title}</div>
                                <div class="muted">{summary.subtitle}</div>
                              </div>
                              <div class="pill">{summary.status}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      ) : (
        <></>
      )}
    </Layout>
  );
}

export function renderStatusPage(model: StatusViewModel): ViewResult {
  const tokenUsage = model.tokenUsage;
  const tokenAssumptions = tokenUsage?.impact.assumptions ?? null;
  const codeforcesStatus = model.codeforces.lastError ? "Degraded" : "OK";
  const codeforcesHint = model.codeforces.lastSuccessAt ? (
    <>
      Last success {renderLocalTime(model.codeforces.lastSuccessAt)}
    </>
  ) : (
    "No successful requests yet."
  );
  return (
    <Layout title="ArugoBot | Status" description="Diagnostics for Codeforces cache health.">
      <section class="hero compact">
        <div>
          <h1>Cache status</h1>
          <p>Last refresh: {renderLocalTime(model.generatedAt)}</p>
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
                    <td>{renderLocalTime(entry.lastFetched)}</td>
                    <td>{formatAgeSeconds(entry.ageSeconds)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section class="section">
        <div class="card">
          <SectionHeader title="Service health" subtitle={`Status: ${formatHealthStatus(model.status)}`} />
          <div class="stats-grid">
            <StatCard label="Database" value={<span>{model.dbOk ? "OK" : "Failed"}</span>} />
            <StatCard label="Codeforces" value={<span>{codeforcesStatus}</span>} hint={codeforcesHint} />
          </div>
          {model.codeforces.lastError ? (
            <div class="muted">
              Last error: {model.codeforces.lastError.message} ({model.codeforces.lastError.endpoint}) •{" "}
              {renderLocalTime(model.codeforces.lastError.timestamp)}
            </div>
          ) : null}
        </div>
      </section>

      <section class="section">
        <div class="card">
          <SectionHeader
            title="Token usage estimates"
            subtitle="Approximate footprint based on GPT-5 (medium) estimates."
          />
          <div class="stats-grid">
            <StatCard
              label="Token total"
              value={<span>{formatTokenValue(tokenUsage?.totalTokens ?? null)}</span>}
              hint={tokenUsage?.lastUpdatedAt ? `Updated ${tokenUsage.lastUpdatedAt}` : undefined}
            />
            <StatCard
              label="Energy estimate (kWh)"
              value={<span>{formatImpactValue(tokenUsage?.impact.energyKwh ?? null)}</span>}
            />
            <StatCard
              label="Water estimate (L)"
              value={<span>{formatImpactValue(tokenUsage?.impact.waterLiters ?? null)}</span>}
            />
            <StatCard
              label="Carbon estimate (kg CO2e)"
              value={<span>{formatImpactValue(tokenUsage?.impact.carbonKg ?? null)}</span>}
            />
          </div>
          {tokenAssumptions ? (
            <div class="muted">
              Assumptions: {tokenAssumptions.model} • {tokenAssumptions.energyWhPerQuery} Wh per
              query • {tokenAssumptions.latencySeconds}s @ {tokenAssumptions.tokensPerSecond} TPS •
              {tokenAssumptions.wueSourceLitersPerKwh} L/kWh •{" "}
              {tokenAssumptions.carbonKgPerKwh} kgCO2/kWh
              <pre class="code-block">{BIBTEX_CITATION}</pre>
            </div>
          ) : (
            <div class="muted">Set CODEX_LOG_PATH to enable token usage estimates.</div>
          )}
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
