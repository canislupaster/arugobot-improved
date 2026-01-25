import { activityCommand } from "./activity.js";
import { challengeCommand } from "./challenge.js";
import { challengesCommand } from "./challenges.js";
import { compareCommand } from "./compare.js";
import { contestCommand } from "./contest.js";
import { contestActivityCommand } from "./contestActivity.js";
import { contestChangesCommand } from "./contestChanges.js";
import { contestHistoryCommand } from "./contestHistory.js";
import { contestRatingAlertsCommand } from "./contestRatingAlerts.js";
import { contestRemindersCommand } from "./contestReminders.js";
import { contestResultsCommand } from "./contestResults.js";
import { contestsCommand } from "./contests.js";
import { dashboardCommand } from "./dashboard.js";
import { handleAdminCommand } from "./handleAdmin.js";
import { handlesCommand } from "./handles.js";
import { healthCommand } from "./health.js";
import { helpCommand } from "./help.js";
import { historyCommand } from "./history.js";
import { leaderboardCommand } from "./leaderboard.js";
import { pingCommand } from "./ping.js";
import { practiceCommand } from "./practice.js";
import { practiceHistoryCommand } from "./practiceHistory.js";
import { practicePrefsCommand } from "./practicePrefs.js";
import { practiceRemindersCommand } from "./practiceReminders.js";
import { problemCommand } from "./problem.js";
import { profileCommand } from "./profile.js";
import { ratingCommand } from "./rating.js";
import { recentCommand } from "./recent.js";
import { refreshCommand } from "./refresh.js";
import { registerCommand, relinkCommand, unlinkCommand } from "./register.js";
import { statsCommand } from "./stats.js";
import { suggestCommand } from "./suggest.js";
import { tournamentCommand } from "./tournament.js";
import { tournamentRecapsCommand } from "./tournamentRecaps.js";
import type { Command } from "./types.js";

export const commandList: Command[] = [
  activityCommand,
  challengeCommand,
  challengesCommand,
  compareCommand,
  contestActivityCommand,
  contestChangesCommand,
  contestCommand,
  contestHistoryCommand,
  contestRatingAlertsCommand,
  contestRemindersCommand,
  contestResultsCommand,
  contestsCommand,
  dashboardCommand,
  handleAdminCommand,
  handlesCommand,
  historyCommand,
  leaderboardCommand,
  pingCommand,
  practiceCommand,
  practiceHistoryCommand,
  practicePrefsCommand,
  practiceRemindersCommand,
  problemCommand,
  profileCommand,
  refreshCommand,
  ratingCommand,
  recentCommand,
  registerCommand,
  relinkCommand,
  unlinkCommand,
  suggestCommand,
  statsCommand,
  tournamentCommand,
  tournamentRecapsCommand,
  helpCommand,
  healthCommand,
];

export const commandMap = new Map(commandList.map((command) => [command.data.name, command]));

export const commandData = commandList.map((command) => command.data.toJSON());
