# For AI agents:

Edit this file to document project structure and any features you have added. The Github issue list should be used to document all in-progress work. Do not add ANYTHING resembling instance locks, or overcomplicate infrastructure. Keep it simple, stupid. If you find yourself incapable of keeping track of the service, it's not because you didn't implement dumb useless features like picking arbitrary ports or global locks. Just use supervisorctl the way god intended.

# ArugoBot

Discord bot with all you need to practice competitive programming and compete against friends on Discord.
Based on https://github.com/eggag32/ArugoBot/ and https://github.com/phattd15/arugo.

## Usage

The following commands are available to you:
Most command responses are public; handle-linking and admin diagnostics remain ephemeral.
Handle inputs (including list options like `handles`) accept Codeforces profile URLs and will extract the handle.

- **/challenge problem** `length` `problem` `[user1..user9]` `[open]` `[max_participants]`

  Starts a challenge.

- **/challenge random** `length` `rating|min_rating|max_rating|ranges` `[tags]` `[user1..user9]` `[open]` `[max_participants]`

  Starts a challenge by selecting a random unsolved problem in the rating range (defaults to 800-3500).
  Use `ranges` for multiple bands, e.g. `800-1200, 1400+, 1600-1800`.
  Use `tags` to require tags and prefix `-` to exclude tags (e.g. `dp, greedy, -math`).
  Set `open` to allow anyone in the server to join before the host starts.
  Use `max_participants` to raise the lobby cap (2-10, default 5).

- **/tournament** `create|join|leave|start|status|advance|cancel|history`

  Runs tournaments in Swiss, elimination, or arena formats. Use `create` to open a lobby, pick
  format, match length, rating ranges, tags, and (optionally) Swiss round count or arena problem count.
  Users join with `join`/`leave`, and the host or an admin can `start` the lobby. Use `advance` to start
  the next round after all matches finish. `status` shows standings, recent rounds,
  and the current round (or arena problem list and time remaining), plus lobby details when pending.
  `history` lists recently completed or cancelled tournaments for the server (select a tournament for a recap
  and export CSV/markdown results).

- **/tournamentrecaps** `set|status|clear|cleanup|post`

  Configure automatic tournament recap posts. Use `set` to choose a channel and optional role mention.
  `post` sends the latest completed tournament recap immediately.

- **/dashboard** `set|status|clear`

  Admin-only web dashboard visibility. Use `set` to opt in/out of the public dashboard,
  `status` to see the current setting, and `clear` to reset to private.

- **/rating** `[user]`

  Shows your (or other user's) rating graph.

- **/history** `[page]`

  Shows a page of your completed challenge history (result + rating delta).

- **/leaderboard** `[page]` `[metric]`

  Shows a page of the server leaderboard (metric can be `rating`, `solves`, `streak`, or `longest_streak`).

- **/profile** `[user]` `[handle]`

  Shows a linked handle, rating, challenge streak, Codeforces profile info, and recent completed challenges (or a handle's Codeforces profile + recent submissions).
  In DMs, provide a `handle`.

- **/compare** `[user1..user4]` `[handles]`

  Compares Codeforces stats for multiple linked users and/or handles.

- **/recent** `[user]` `[handle]` `[limit]` `[result]`

  Shows recent Codeforces submissions for a linked user or a handle.
  Use `result` to filter by `all`, `accepted`, or `rejected` submissions.
  In DMs, provide a `handle`.

- **/register** `handle`

  Links your CF account.
  Verification prompts include a cancel button if you need to stop the flow.
  You can paste a Codeforces profile URL; the handle will be extracted.

- **/relink** `handle`

  Updates your linked CF handle (use if you changed your Codeforces handle).
  Verification prompts include a cancel button if you need to stop the flow.
  You can paste a Codeforces profile URL; the handle will be extracted.

- **/unlink**

  Unlinks your CF account and erases all progress.

- **/suggest** `rating|min_rating|max_rating|ranges` `[tags]` `[handles]`

  Gives some problems in the rating range that none of the CF accounts have done (defaults to 800-3500).
  If `handles` is omitted, uses linked handles in the server.
  Use `ranges` for multiple bands, e.g. `800-1200, 1400+, 1600-1800`.
  Use `tags` to require tags and prefix `-` to exclude tags (e.g. `dp, greedy, -math`).

- **/practice** `rating|min_rating|max_rating|ranges` `[tags]` `[user]` `[handle]`

  Suggests a single unsolved practice problem for a linked user or a Codeforces handle.
  If `handle` is omitted, uses the linked handle for `user` (or yourself).
  Use `ranges` for multiple bands, e.g. `800-1200, 1400+, 1600-1800`.
  Use `tags` to require tags and prefix `-` to exclude tags (e.g. `dp, greedy, -math`).

- **/practiceprefs** `set|status|clear` `rating|min_rating|max_rating|ranges` `[tags]`

  Sets default rating ranges/tags used by `/practice` when you omit filters, or shows/clears them.

- **/practicehistory** `suggestions` `[user]` `[limit]` | `reminders` `[limit]`

  Shows recent practice suggestions for a user or recent practice reminder posts for the server.

- **/problem** `id`

  Shows details for a Codeforces problem by id or URL, plus which linked users have solved it.

- **/help**

  Prints the help message.

- **/challenges** `list` `[limit]` | `cancel` | `mine` | `recent` `[limit]`

  Lists active challenges for the server or lets the host/admin cancel one.
  Use `mine` to see your active challenge.
  Use `recent` to see recently completed challenges for the server.

- **/handles** `[page]`

  Lists linked Codeforces handles for the server.

- **/handleadmin** `set|unlink|status` `user` `[handle]`

  Admin-only handle management (link/update, unlink, or inspect a user's handle).

- **/health**

  Admin-only diagnostics (uptime, memory, DB status, reminder channel issues, last error, command usage/latency).

- **/logs** `[limit]` `[level]` `[command]` `[correlation]` `[message]` `[user]`

  Admin-only log viewer for recent bot activity in the server.

- **/refresh** `[scope]`

  Admin-only refresh of cached Codeforces data (problems, contests, and handle canonicalization).

- **/ping**

  Quick liveness check.

- **/stats**

  Shows server challenge stats plus recent contest participation (linked users, challenges, ratings, contest counts).

- **/activity** `[days]` `[user]`

  Shows challenge activity summaries for the server or a specific user over a lookback window.

- **/streak** `[user]`

  Shows the current and longest challenge streak for a user (UTC days with at least one solved challenge).

- **/contests** `[limit]` `[include]` `[exclude]` `[scope]`

  Lists ongoing and upcoming Codeforces contests. Use `include`/`exclude` to filter by keywords
  (comma-separated, matched against the contest name). Use `scope` to show `official`, `gym`,
  or `all` contests.

- **/contest** `query` `[scope]`

  Shows details for a contest by id, URL, name, `latest` (most recent finished contest),
  `next`/`upcoming` (soonest upcoming contest), or `ongoing` (current contest if any).
  Use `scope` to search `official`, `gym`, or `all` contests.

- **/contestresults** `query` `[limit]` `[user1..user4]` `[handles]` `[scope]`

  Shows standings for linked users (or specified handles) in a contest.
  Use `latest` to target the most recent finished contest.
  Use `include_practice` to include practice submissions in the standings.

- **/contestchanges** `query` `[limit]` `[user1..user4]` `[handles]` `[scope]`

  Shows rating changes for linked users (or specified handles) in a finished contest.
  Use `latest` to target the most recent finished contest.
  Rating changes are only available for official contests; gym contests show a warning.

- **/contestsolves** `query` `[limit]` `[user1..user4]` `[handles]` `[scope]`

  Shows which contest problems linked users have solved and highlights unsolved problems.
  Use `latest` to target the most recent finished contest.
  Provide handles or users to limit the list (handles are required outside a server).

- **/contestupsolve** `query` `[user]` `[handle]` `[limit]` `[scope]`

  Shows unsolved contest problems for a linked user or a Codeforces handle.
  Use `latest` to target the most recent finished contest.

- **/contesthistory** `[user]` `[handle]` `[limit]`

  Shows recent Codeforces contest rating changes for a linked user or handle.

- **/contestactivity** `[days]` `[limit]` `[scope]`

  Shows recent contest participation for the server's linked handles, including top participants and recent contests.

- **/contestdeltas** `[days]` `[limit]`

  Shows recent contest rating deltas for the server's linked handles, including top gainers/losers.

- **/contestreminders** `add|set|list|status|preset|remove|clear|cleanup|preview|post`

  Configure contest reminders for the server (admin only). Use `add` (or legacy `set`) to create
  multiple subscriptions with distinct channel, lead time, role mention, and keyword filters
  (`include`/`exclude`, comma-separated) plus contest `scope` (official, gym, or all). Use
  `list`/`status` to see subscription ids, `remove` to delete one, `clear` to delete all, and
  `cleanup` to remove subscriptions pointing at deleted channels (use `include_permissions:true`
  to also remove subscriptions where the bot lacks channel permissions).
  `preview`/`post` accept an optional subscription id when multiple are configured. `post` can
  `force` a reminder even if one was already posted. `preset` adds a curated subscription (Div 2,
  Div 3, Div 4, or Educational) with sensible keyword filters.
  Subscriptions are automatically removed if the target channel is deleted.

- **/contestratingalerts** `set|status|list|remove|clear|cleanup|preview|post`

  Configure rating change alerts for finished contests (admin only). Use `set` to choose a channel
  and optional role mention, `min_delta` filter, and `handles` filter (comma-separated, linked
  handles only). `cleanup` removes subscriptions pointing at deleted channels (add
  `include_permissions:true` to also remove ones missing bot permissions). `preview` shows the next
  alert for linked handles, and `post` sends the latest rating change summary immediately (optionally
  `force` to resend).

- **/practicereminders** `set|status|clear|cleanup|preview|post`

  Configure practice problem reminders (admin only). Use `set` to choose a channel, time, optional `utc_offset` (e.g. `+02:00`, `-05:30`, `Z`), optional `days` (e.g. `mon,wed,fri`, `weekdays`, `weekends`), rating ranges, optional tags, and an optional role mention. If `utc_offset` is omitted the time is interpreted as UTC. Use `cleanup` to remove reminders pointing at deleted channels (add `include_permissions:true` to also remove ones missing bot permissions).
  Use `post` to send a practice problem immediately (optionally `force` to send even if one was posted today).
  Reminders are automatically cleared if the target channel is deleted.

- **/digest** `set|status|clear|preview|post`

  Configure a weekly digest for the server (admin only). Use `set` to choose a channel, day, time, optional `utc_offset`, and optional role mention.
  Digests include challenge activity, top contests by participation, and rating delta highlights.
  Use `post` to send a digest immediately (optionally `force` to send even if one was already posted this week).

Reminder and digest channels must grant the bot View Channel + Send Messages permissions; the `set` flows will warn if the bot cannot post.

## Installation

To try the bot, join the Purdue CPU Discord: https://purduecpu.com/discord
If you want to host it, install dependencies with pnpm (Node 18+), set the required env vars, and run the bot:

Required environment variables:

- `DISCORD_TOKEN`
- `DATABASE_URL` (e.g. `sqlite:./bot_data.db`)

Optional environment variables:

- `DISCORD_GUILD_ID` (register slash commands for a single guild for faster updates)
- `CODEFORCES_API_BASE_URL` (default `https://codeforces.com/api`)
- `CODEFORCES_REQUEST_DELAY_MS` (default `2000`)
- `CODEFORCES_TIMEOUT_MS` (default `10000`)
- `CODEFORCES_STATUS_TIMEOUT_MS` (default `20000`, used for `contest.status`/`user.status`)
- `CODEFORCES_SOLVED_MAX_PAGES` (default `10`, set `0` for unlimited)
- `PROXY_FETCH_URL` (optional proxy list URL; one proxy per line as `host:port` or `host:port:user:pass`)
- `LOG_RETENTION_DAYS` (default `30`, set `0` to disable log cleanup)
- `DATABASE_BACKUP` (directory for automated backups, disabled if unset)
- `DATABASE_BACKUP_RETENTION_DAYS` (default `7`, set `0` to keep all backups)
- `CODEX_LOG_PATH` (path to the Codex log file for token usage estimates, e.g. `../codex.log`)
- `WEB_HOST` (default `0.0.0.0`)
- `WEB_PORT` (default `8787`, set `0` to bind a random open port)
- `WEB_PUBLIC_URL` (optional, e.g. `https://bot.example.com`, used for `/dashboard` links)

```bash
pnpm install
pnpm approve-builds
pnpm run dev
```

## Releases

Tagged releases (`v*`) publish a source archive on GitHub Releases. You can download the latest
release archive from the Releases page and follow the installation steps above.

The bot runs database migrations on startup.
Problem and contest caches are persisted in the database to keep basic functionality available during Codeforces outages.
Structured logs are appended to the database (`log_entries`) and cleaned up automatically based on
`LOG_RETENTION_DAYS`. If `DATABASE_BACKUP` is set, the bot copies the sqlite file into that directory
on a schedule and removes backups older than `DATABASE_BACKUP_RETENTION_DAYS`.

## Web dashboard

The bot serves a Hono-powered dashboard for global stats and per-guild leaderboards.
By default it listens on `http://localhost:8787` (override with `WEB_HOST`/`WEB_PORT`).
If the configured port is busy, the bot will retry a couple of nearby ports and fall back to a random
open port, logging the chosen port on startup.
Only guilds that opt in via `/dashboard set public:true` appear on the public pages.
If `WEB_PUBLIC_URL` is set, `/dashboard` responses include direct links to your guild page.
The overview highlights core bot features alongside upcoming contest cards, plus global contest
participation snapshots sourced from cached rating changes (split by official vs gym activity),
contest rating alert coverage, and rating-change cache freshness. Per-guild pages include
CSV/Markdown exports for rating/solve leaderboards, and `/status` shows cache ages for key
Codeforces syncs including the gym contest list. Tournament summaries link to full recap pages
at `/guilds/:guildId/tournaments/:tournamentId` (with rounds, match results, and problem lists), and
`/api/guilds/:guildId/tournaments/:tournamentId` exposes the same data as JSON.
`/status.json` returns the same cache status in JSON for external monitoring.
`/api/overview` returns the global snapshot and public guild summaries as JSON, and
`/api/guilds/:guildId` returns the per-guild overview payload (respecting the public dashboard setting).
`/healthz` returns JSON with a quick DB + Codeforces check plus cache status (useful for uptime monitors).

## Token usage estimates

If `CODEX_LOG_PATH` is set, the bot periodically scans the log for token totals and reports
approximate energy, water, and carbon estimates (GPT-5 medium assumptions) in `/health` and
the `/status` dashboard page.

```
@misc{jegham2025hungryaibenchmarkingenergy,
      title={How Hungry is AI? Benchmarking Energy, Water, and Carbon Footprint of LLM Inference},
      author={Nidhal Jegham and Marwan Abdelatti and Chan Young Koh and Lassad Elmoubarki and Abdeltawab Hendawi},
      year={2025},
      eprint={2505.09598},
      archivePrefix={arXiv},
      primaryClass={cs.CY},
      url={https://arxiv.org/abs/2505.09598},
}
```

## Deployment (Supervisor + Caddy)

Sample configs live in `deploy/` and assume you are running on a Linux host with `systemd`.
Use `supervisorctl` for start/stop to avoid running multiple instances (which can cause the dashboard
port to be in use).

1. Install dependencies and allow native build scripts:

```bash
pnpm install
pnpm approve-builds
```

2. Configure Supervisor (update the Node + project paths):

```bash
sudo cp deploy/supervisor.conf /etc/supervisor/conf.d/arugobot.conf
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl status
```

To restart or inspect logs:

```bash
sudo supervisorctl stop arugobot
sudo supervisorctl start arugobot
sudo supervisorctl tail -f arugobot
```

3. Configure Caddy (update the domain name):

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Sample Caddyfile (TLS via subdomain + reverse proxy):

```text
arugobot.purduecpu.com {
  reverse_proxy http://localhost:8787
}
```

4. Confirm the web server responds:

```bash
curl -I http://127.0.0.1:8787
```

Quality gates:

```bash
pnpm run lint
pnpm run format
pnpm run test
pnpm run build
```

To typecheck and run the production bot (tsx runtime, no JS build output):

```bash
pnpm run build
pnpm start
```

## Future TODOs

- Expand the weekly digest with richer contest analytics (per-contest highlights, streaks).
