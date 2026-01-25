# For AI agents:

Edit this file to document project structure and any features you have added. The Github issue list should be used to document all in-progress work.

# ArugoBot

Discord bot with all you need to practice competitive programming and compete against friends on Discord.

## Usage

The following commands are available to you:
Most command responses are public; handle-linking and admin diagnostics remain ephemeral.

- **/challenge problem** `length` `problem` `[user1..user9]` `[open]` `[max_participants]`

  Starts a challenge.

- **/challenge random** `length` `rating|min_rating|max_rating|ranges` `[tags]` `[user1..user9]` `[open]` `[max_participants]`

  Starts a challenge by selecting a random unsolved problem in the rating range (defaults to 800-3500).
  Use `ranges` for multiple bands, e.g. `800-1200, 1400, 1600-1800`.
  Use `tags` to require tags and prefix `-` to exclude tags (e.g. `dp, greedy, -math`).
  Set `open` to allow anyone in the server to join before the host starts.
  Use `max_participants` to raise the lobby cap (2-10, default 5).

- **/tournament** `create|status|advance|cancel|history`

  Runs multi-round tournaments with Swiss or elimination formats. Use `create` to open a lobby, pick
  format, match length, rating ranges, tags, and (optionally) Swiss round count. Use `advance` to
  start the next round after all matches finish. `status` shows standings, recent rounds, and the current round.
  `history` lists recently completed or cancelled tournaments for the server (select a tournament for a recap
  and export CSV/markdown results).

- **/tournamentrecaps** `set|status|clear|post`

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

  Shows a page of the server leaderboard (metric can be `rating` or `solves`).

- **/profile** `[user]` `[handle]`

  Shows a linked handle, rating, Codeforces profile info, and recent completed challenges (or a handle's Codeforces profile + recent submissions).

- **/compare** `[user1..user4]` `[handles]`

  Compares Codeforces stats for multiple linked users and/or handles.

- **/recent** `[user]` `[handle]` `[limit]`

  Shows recent Codeforces submissions for a linked user or a handle.

- **/register** `handle`

  Links your CF account.
  Verification prompts include a cancel button if you need to stop the flow.

- **/relink** `handle`

  Updates your linked CF handle (use if you changed your Codeforces handle).
  Verification prompts include a cancel button if you need to stop the flow.

- **/unlink**

  Unlinks your CF account and erases all progress.

- **/suggest** `rating|min_rating|max_rating|ranges` `[tags]` `[handles]`

  Gives some problems in the rating range that none of the CF accounts have done (defaults to 800-3500).
  If `handles` is omitted, uses linked handles in the server.
  Use `ranges` for multiple bands, e.g. `800-1200, 1400, 1600-1800`.
  Use `tags` to require tags and prefix `-` to exclude tags (e.g. `dp, greedy, -math`).

- **/practice** `rating|min_rating|max_rating|ranges` `[tags]` `[user]` `[handle]`

  Suggests a single unsolved practice problem for a linked user or a Codeforces handle.
  If `handle` is omitted, uses the linked handle for `user` (or yourself).
  Use `ranges` for multiple bands, e.g. `800-1200, 1400, 1600-1800`.
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

  Admin-only diagnostics (uptime, memory, DB status, last error, command usage/latency).

- **/refresh** `[scope]`

  Admin-only refresh of cached Codeforces data (problems, contests, and handle canonicalization).

- **/ping**

  Quick liveness check.

- **/stats**

  Shows server challenge stats (linked users, total challenges, ratings).

- **/activity** `[days]` `[user]`

  Shows challenge activity summaries for the server or a specific user over a lookback window.

- **/contests** `[limit]` `[include]` `[exclude]`

  Lists ongoing and upcoming Codeforces contests. Use `include`/`exclude` to filter by keywords
  (comma-separated, matched against the contest name).

- **/contest** `query`

  Shows details for a contest by id, URL, or name.

- **/contestresults** `query` `[limit]` `[user1..user4]` `[handles]`

  Shows standings for linked users (or specified handles) in a contest.
  Use `latest` to target the most recent finished contest.

- **/contestchanges** `query` `[limit]` `[user1..user4]` `[handles]`

  Shows rating changes for linked users (or specified handles) in a finished contest.
  Use `latest` to target the most recent finished contest.

- **/contesthistory** `[user]` `[handle]` `[limit]`

  Shows recent Codeforces contest rating changes for a linked user or handle.

- **/contestactivity** `[days]` `[limit]`

  Shows recent contest participation for the server's linked handles, including top participants and recent contests.

- **/contestreminders** `add|set|list|status|preset|remove|clear|preview|post`

  Configure contest reminders for the server (admin only). Use `add` (or legacy `set`) to create
  multiple subscriptions with distinct channel, lead time, role mention, and keyword filters
  (`include`/`exclude`, comma-separated). Use `list`/`status` to see subscription ids, `remove` to
  delete one, and `clear` to delete all. `preview`/`post` accept an optional subscription id when
  multiple are configured. `post` can `force` a reminder even if one was already posted.
  `preset` adds a curated subscription (Div 2 or Educational) with sensible keyword filters.

- **/contestratingalerts** `set|status|list|remove|clear|preview|post`

  Configure rating change alerts for finished contests (admin only). Use `set` to choose a channel
  and optional role mention, `min_delta` filter, and `handles` filter (comma-separated, linked
  handles only). `preview` shows the next alert for linked handles, and `post` sends the latest
  rating change summary immediately (optionally `force` to resend).

- **/practicereminders** `set|status|clear|preview|post`

  Configure practice problem reminders (admin only). Use `set` to choose a channel, time, optional `utc_offset` (e.g. `+02:00`, `-05:30`, `Z`), optional `days` (e.g. `mon,wed,fri`, `weekdays`, `weekends`), rating ranges, optional tags, and an optional role mention. If `utc_offset` is omitted the time is interpreted as UTC.
  Use `post` to send a practice problem immediately (optionally `force` to send even if one was posted today).

## Installation

To invite the instance I am hosting, use this [link](https://discord.com/oauth2/authorize?client_id=1325529003473240124&permissions=277025507392&integration_type=0&scope=bot).
If you want to host it, install dependencies with pnpm (Node 18+), set the required env vars, and run the bot:

Required environment variables:

- `DISCORD_TOKEN`
- `DATABASE_URL` (e.g. `sqlite:./bot_data.db`)

Optional environment variables:

- `DISCORD_GUILD_ID` (register slash commands for a single guild for faster updates)
- `CODEFORCES_API_BASE_URL` (default `https://codeforces.com/api`)
- `CODEFORCES_REQUEST_DELAY_MS` (default `2000`)
- `CODEFORCES_TIMEOUT_MS` (default `10000`)
- `CODEFORCES_SOLVED_MAX_PAGES` (default `10`, set `0` for unlimited)
- `WEB_HOST` (default `0.0.0.0`)
- `WEB_PORT` (default `8787`)

```bash
pnpm install
pnpm approve-builds
pnpm run dev
```

The bot runs database migrations on startup.
Problem and contest caches are persisted in the database to keep basic functionality available during Codeforces outages.

## Web dashboard

The bot serves a Hono-powered dashboard for global stats and per-guild leaderboards.
By default it listens on `http://localhost:8787` (override with `WEB_HOST`/`WEB_PORT`).
Only guilds that opt in via `/dashboard set public:true` appear on the public pages.
The overview includes global contest participation cards sourced from cached rating changes.
Per-guild pages include CSV/Markdown exports for rating/solve leaderboards, and `/status` shows
cache ages for key Codeforces syncs.

## Deployment (Supervisor + Caddy)

Sample configs live in `deploy/` and assume you are running on a Linux host with `systemd`.

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

- Add gym contest support for `/contests` and reminders.
- Add a weekly digest post for guild activity and contest participation.
