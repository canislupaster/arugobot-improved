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
  guild_id: string;
  channel_id: string;
  minutes_before: number;
  role_id: string | null;
  include_keywords: string | null;
  exclude_keywords: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
};

export type ContestNotificationsTable = {
  guild_id: string;
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
  contest_standings_cache: ContestStandingsCacheTable;
  practice_reminders: PracticeRemindersTable;
  practice_posts: PracticePostsTable;
  practice_suggestions: PracticeSuggestionsTable;
  practice_preferences: PracticePreferencesTable;
  tournaments: TournamentsTable;
  tournament_participants: TournamentParticipantsTable;
  tournament_rounds: TournamentRoundsTable;
  tournament_matches: TournamentMatchesTable;
  tournament_recap_settings: TournamentRecapSettingsTable;
};
