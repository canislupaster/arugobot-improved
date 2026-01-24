# For AI agents:

Edit this file to document project structure and any features you add or are pursuing.

# TODO

- Extend to tournaments with any number of participants and various formats (Swiss, elimination, etc).

When this TODO list clears up, continue adding ideas!

# ArugoBot

Discord bot with all you need to practice competitive programming and compete against friends on Discord.

## Usage

The following commands are available to you:

- **/challenge** `problem` `length` `[user1..user4]` `[open]`

  Starts a challenge.

- **/challenge** `length` `rating|min_rating|max_rating|ranges` `[tags]` `[user1..user4]` `[open]`

  Starts a challenge by selecting a random unsolved problem in the rating range (defaults to 800-3500).
  Use `ranges` for multiple bands, e.g. `800-1200, 1400, 1600-1800`.
  Use `tags` to require tags and prefix `-` to exclude tags (e.g. `dp, greedy, -math`).
  Set `open` to allow anyone in the server to join before the host starts.

- **/rating** `[user]`

  Shows your (or other user's) rating graph.

- **/history** `[page]`

  Shows a page of your completed challenge history (result + rating delta).

- **/leaderboard** `[page]`

  Shows a page of the server leaderboard.

- **/profile** `[user]` `[handle]`

  Shows a linked handle, rating, Codeforces profile info, and recent completed challenges (or a handle's Codeforces profile + recent submissions).

- **/compare** `[user1..user4]` `[handles]`

  Compares Codeforces stats for multiple linked users and/or handles.

- **/recent** `[user]` `[handle]` `[limit]`

  Shows recent Codeforces submissions for a linked user or a handle.

- **/register** `handle`

  Links your CF account.

- **/relink** `handle`

  Updates your linked CF handle (use if you changed your Codeforces handle).

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

- **/health**

  Admin-only diagnostics (uptime, memory, DB status, last error).

- **/refresh** `[scope]`

  Admin-only refresh of cached Codeforces data (problems, contests, and handle canonicalization).

- **/ping**

  Quick liveness check.

- **/stats**

  Shows server challenge stats (linked users, total challenges, ratings).

- **/contests** `[limit]`

  Lists ongoing and upcoming Codeforces contests.

- **/contestreminders** `set|status|clear|preview`

  Configure contest reminders for the server (admin only). Use `set` to choose a channel, lead time, and optional role mention.

- **/practicereminders** `set|status|clear|preview|post`

  Configure daily practice problem reminders (admin only). Use `set` to choose a channel, UTC time, rating ranges, optional tags, and an optional role mention.
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

```bash
pnpm install
pnpm run dev
```

The bot runs database migrations on startup.
Problem and contest caches are persisted in the database to keep basic functionality available during Codeforces outages.

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
