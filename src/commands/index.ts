import { challengeCommand } from "./challenge.js";
import { compareCommand } from "./compare.js";
import { contestsCommand } from "./contests.js";
import { handlesCommand } from "./handles.js";
import { healthCommand } from "./health.js";
import { helpCommand } from "./help.js";
import { historyCommand } from "./history.js";
import { leaderboardCommand } from "./leaderboard.js";
import { pingCommand } from "./ping.js";
import { profileCommand } from "./profile.js";
import { ratingCommand } from "./rating.js";
import { recentCommand } from "./recent.js";
import { registerCommand, unlinkCommand } from "./register.js";
import { statsCommand } from "./stats.js";
import { suggestCommand } from "./suggest.js";
import type { Command } from "./types.js";

export const commandList: Command[] = [
  challengeCommand,
  compareCommand,
  contestsCommand,
  handlesCommand,
  historyCommand,
  leaderboardCommand,
  pingCommand,
  profileCommand,
  ratingCommand,
  recentCommand,
  registerCommand,
  unlinkCommand,
  suggestCommand,
  statsCommand,
  helpCommand,
  healthCommand,
];

export const commandMap = new Map(commandList.map((command) => [command.data.name, command]));

export const commandData = commandList.map((command) => command.data.toJSON());
