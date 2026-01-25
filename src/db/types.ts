import type { Generated } from "kysely";

export type UsersTable = {
  server_id: string;
  user_id: string;
  handle: string;
  rating: number;
  history: string;
  rating_history: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
};

export type AcTable = {
  handle: string;
  solved: string;
  last_sub: number;
  updated_at: Generated<string>;
};

export type CfHandlesTable = {
  handle: string;
  canonical_handle: string | null;
  exists: number;
  last_checked: Generated<string>;
};

export type CfProfilesTable = {
  handle: string;
  display_handle: string;
  rating: number | null;
  rank: string | null;
  max_rating: number | null;
  max_rank: string | null;
  last_online: number | null;
  last_fetched: Generated<string>;
};

export type CfRecentSubmissionsTable = {
  handle: string;
  submissions: string;
  last_fetched: Generated<string>;
};

export type CfCacheTable = {
  key: string;
  payload: string;
  last_fetched: Generated<string>;
};

export type CfRatingChangesTable = {
  handle: string;
  payload: string;
  last_fetched: Generated<string>;
};

export type ChallengesTable = {
  id: string;
  server_id: string;
  channel_id: string;
  message_id: string;
  host_user_id: string;
  problem_contest_id: number;
  problem_index: string;
  problem_name: string;
  problem_rating: number;
  length_minutes: number;
  status: string;
  started_at: number;
  ends_at: number;
  check_index: number;
  created_at: Generated<string>;
  updated_at: Generated<string>;
};

export type ChallengeParticipantsTable = {
  challenge_id: string;
  user_id: string;
  position: number;
  solved_at: number | null;
  rating_before: number | null;
  rating_delta: number | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
};

export type ContestRemindersTable = {
  id: string;
  guild_id: string;
  channel_id: string;
  minutes_before: number;
  role_id: string | null;
  include_keywords: string | null;
  exclude_keywords: string | null;
  scope: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
};

export type ContestNotificationsTable = {
  subscription_id: string;
  contest_id: number;
  notified_at: Generated<string>;
};

export type ContestRatingAlertSubscriptionsTable = {
  id: string;
  guild_id: string;
  channel_id: string;
  role_id: string | null;
  min_delta: number;
  include_handles: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
};

export type ContestRatingAlertNotificationsTable = {
  subscription_id: string;
  contest_id: number;
  notified_at: Generated<string>;
};

export type ContestStandingsCacheTable = {
  contest_id: number;
  handles_hash: string;
  handles: string;
  payload: string;
  last_fetched: Generated<string>;
};

export type ContestRatingChangesTable = {
  contest_id: number;
  payload: string;
  last_fetched: Generated<string>;
};

export type PracticeRemindersTable = {
  guild_id: string;
  channel_id: string;
  hour_utc: number;
  minute_utc: number;
  utc_offset_minutes: number;
  days_of_week: string | null;
  rating_ranges: string;
  tags: string;
  role_id: string | null;
  last_sent_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
};

export type PracticePostsTable = {
  guild_id: string;
  problem_id: string;
  sent_at: Generated<string>;
};

export type PracticeSuggestionsTable = {
  guild_id: string;
  user_id: string;
  problem_id: string;
  suggested_at: Generated<string>;
};

export type PracticePreferencesTable = {
  guild_id: string;
  user_id: string;
  rating_ranges: string;
  tags: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
};

export type TournamentsTable = {
  id: string;
  guild_id: string;
  channel_id: string;
  host_user_id: string;
  format: string;
  status: string;
  length_minutes: number;
  round_count: number;
  current_round: number;
  rating_ranges: string;
  tags: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
};

export type TournamentParticipantsTable = {
  tournament_id: string;
  user_id: string;
  seed: number;
  score: number;
  wins: number;
  losses: number;
  draws: number;
  eliminated: number;
  created_at: Generated<string>;
  updated_at: Generated<string>;
};

export type TournamentRoundsTable = {
  id: string;
  tournament_id: string;
  round_number: number;
  status: string;
  problem_contest_id: number;
  problem_index: string;
  problem_name: string;
  problem_rating: number;
  created_at: Generated<string>;
  updated_at: Generated<string>;
};

export type TournamentMatchesTable = {
  id: string;
  tournament_id: string;
  round_id: string;
  match_number: number;
  challenge_id: string | null;
  player1_id: string;
  player2_id: string | null;
  winner_id: string | null;
  status: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
};

export type TournamentRecapSettingsTable = {
  guild_id: string;
  channel_id: string;
  role_id: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
};

export type TournamentArenaStateTable = {
  tournament_id: string;
  starts_at: number;
  ends_at: number;
  problem_count: number;
  created_at: Generated<string>;
  updated_at: Generated<string>;
};

export type TournamentArenaProblemsTable = {
  tournament_id: string;
  problem_contest_id: number;
  problem_index: string;
  problem_name: string;
  problem_rating: number;
  problem_tags: string;
  created_at: Generated<string>;
};

export type TournamentArenaSolvesTable = {
  tournament_id: string;
  user_id: string;
  problem_contest_id: number;
  problem_index: string;
  submission_id: number | null;
  solved_at: number;
  created_at: Generated<string>;
};

export type TournamentLobbiesTable = {
  id: string;
  guild_id: string;
  channel_id: string;
  host_user_id: string;
  format: string;
  length_minutes: number;
  max_participants: number;
  rating_ranges: string;
  tags: string;
  swiss_rounds: number | null;
  arena_problem_count: number | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
};

export type TournamentLobbyParticipantsTable = {
  lobby_id: string;
  user_id: string;
  created_at: Generated<string>;
};

export type CommandMetricsTable = {
  command: string;
  count: number;
  success_count: number;
  failure_count: number;
  total_latency_ms: number;
  max_latency_ms: number;
  last_seen_at: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
};

export type LogEntriesTable = {
  id: Generated<number>;
  timestamp: string;
  level: string;
  message: string;
  correlation_id: string | null;
  command: string | null;
  guild_id: string | null;
  user_id: string | null;
  latency_ms: number | null;
  context_json: string | null;
};

export type GuildSettingsTable = {
  guild_id: string;
  dashboard_public: number;
  created_at: Generated<string>;
  updated_at: Generated<string>;
};

export type WeeklyDigestsTable = {
  guild_id: string;
  channel_id: string;
  day_of_week: number;
  hour_utc: number;
  minute_utc: number;
  utc_offset_minutes: number;
  role_id: string | null;
  last_sent_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
};

export type Database = {
  users: UsersTable;
  ac: AcTable;
  cf_handles: CfHandlesTable;
  cf_profiles: CfProfilesTable;
  cf_recent_submissions: CfRecentSubmissionsTable;
  cf_cache: CfCacheTable;
  cf_rating_changes: CfRatingChangesTable;
  challenges: ChallengesTable;
  challenge_participants: ChallengeParticipantsTable;
  contest_reminders: ContestRemindersTable;
  contest_notifications: ContestNotificationsTable;
  contest_rating_alert_subscriptions: ContestRatingAlertSubscriptionsTable;
  contest_rating_alert_notifications: ContestRatingAlertNotificationsTable;
  contest_standings_cache: ContestStandingsCacheTable;
  contest_rating_changes: ContestRatingChangesTable;
  practice_reminders: PracticeRemindersTable;
  practice_posts: PracticePostsTable;
  practice_suggestions: PracticeSuggestionsTable;
  practice_preferences: PracticePreferencesTable;
  tournaments: TournamentsTable;
  tournament_participants: TournamentParticipantsTable;
  tournament_rounds: TournamentRoundsTable;
  tournament_matches: TournamentMatchesTable;
  tournament_recap_settings: TournamentRecapSettingsTable;
  tournament_arena_state: TournamentArenaStateTable;
  tournament_arena_problems: TournamentArenaProblemsTable;
  tournament_arena_solves: TournamentArenaSolvesTable;
  tournament_lobbies: TournamentLobbiesTable;
  tournament_lobby_participants: TournamentLobbyParticipantsTable;
  command_metrics: CommandMetricsTable;
  log_entries: LogEntriesTable;
  guild_settings: GuildSettingsTable;
  weekly_digests: WeeklyDigestsTable;
};
