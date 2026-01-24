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

export type Database = {
  users: UsersTable;
  ac: AcTable;
  cf_handles: CfHandlesTable;
  cf_profiles: CfProfilesTable;
};
