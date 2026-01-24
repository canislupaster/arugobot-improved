# ArugoBot
When my friends and I were practicing for competitive programming contests we used [Arugo](https://github.com/phattd15/arugo) quite a bit, and it was a lot of fun.
After some time it stopped being hosted (I rehosted it [here](https://eggag33.pythonanywhere.com/) and it seems to work though).
So I decided to write a Discord bot with similar functionality: my hope is that it makes it more convenient to practice with others.
Credit (and thanks!) to [phattd15](https://github.com/phattd15)/[polarity-ac](https://github.com/polarity-ac) for the original idea!

## Usage
The following commands are available to you:

- **/challenge** `problem` `length` `[user1..user4]`

  Starts a challenge.
- **/rating** `[user]`
  
  Shows your (or other user's) rating graph.
- **/history** `[page]`

  Shows a page of your challenge history.
- **/leaderboard** `[page]`

  Shows a page of the server leaderboard.
- **/profile** `[user]`

  Shows a linked handle, rating, Codeforces profile info, and recent activity.
- **/register** `handle`

  Links your CF account.
- **/unlink**

  Unlinks your CF account and erases all progress.
- **/suggest** `rating` `[handles]`

  Gives some problems at a given rating that none of the CF accounts have done.
  If `handles` is omitted, uses linked handles in the server.
- **/help**

  Prints the help message.
- **/handles** `[page]`

  Lists linked Codeforces handles for the server.
- **/health**

  Admin-only diagnostics (uptime, memory, DB status, last error).
- **/ping**

  Quick liveness check.
- **/stats**

  Shows server challenge stats (linked users, total challenges, ratings).
- **/contests** `[limit]`

  Lists ongoing and upcoming Codeforces contests.

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

```bash
pnpm install
pnpm run dev
```

The bot runs database migrations on startup.

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
