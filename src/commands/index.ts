import { challengeCommand } from "./challenge.js";
import { challengesCommand } from "./challenges.js";
import { compareCommand } from "./compare.js";
import { contestRemindersCommand } from "./contestReminders.js";
import { contestsCommand } from "./contests.js";
import { handlesCommand } from "./handles.js";
import { healthCommand } from "./health.js";
import { helpCommand } from "./help.js";
import { historyCommand } from "./history.js";
import { leaderboardCommand } from "./leaderboard.js";
import { pingCommand } from "./ping.js";
import { practiceRemindersCommand } from "./practiceReminders.js";
import { problemCommand } from "./problem.js";
import { profileCommand } from "./profile.js";
import { ratingCommand } from "./rating.js";
import { recentCommand } from "./recent.js";
import { refreshCommand } from "./refresh.js";
import { registerCommand, unlinkCommand } from "./register.js";
import { statsCommand } from "./stats.js";
import { suggestCommand } from "./suggest.js";
import type { Command } from "./types.js";

export const commandList: Command[] = [
  challengeCommand,
  challengesCommand,
  compareCommand,
  contestRemindersCommand,
  contestsCommand,
  handlesCommand,
  historyCommand,
  leaderboardCommand,
  pingCommand,
  practiceRemindersCommand,
  problemCommand,
  profileCommand,
  refreshCommand,
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
