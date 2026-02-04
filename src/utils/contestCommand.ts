import type { ChatInputCommandInteraction, User } from "discord.js";

import type { Contest, ContestScopeFilter, ContestService } from "../services/contests.js";

import { resolveContestOrReply, type ContestLookupReplyOptions } from "./contestLookup.js";
import { refreshContestData } from "./contestScope.js";
import { resolveContestTargetInputsOrReply } from "./contestTargets.js";

type ContestCommandServices = {
  contests: Pick<
    ContestService,
    | "refresh"
    | "getLastRefreshAt"
    | "getLatestFinished"
    | "getUpcoming"
    | "getOngoing"
    | "getContestById"
    | "searchContests"
  >;
};

type ContestCommandResolveResult =
  | {
      status: "ok";
      contest: Contest;
      stale: boolean;
      targetInputs: { handleInputs: string[]; userOptions: User[] };
    }
  | { status: "replied" };

export async function resolveContestContextOrReply(params: {
  interaction: ChatInputCommandInteraction;
  services: ContestCommandServices;
  queryRaw: string;
  handlesRaw: string;
  scope: ContestScopeFilter;
  maxMatches: number;
  lookupOptions: Omit<ContestLookupReplyOptions, "maxMatches" | "refreshWasStale">;
}): Promise<ContestCommandResolveResult> {
  const targetInputs = await resolveContestTargetInputsOrReply(
    params.interaction,
    params.handlesRaw
  );
  if (targetInputs.status === "replied") {
    return { status: "replied" };
  }

  await params.interaction.deferReply();

  const refreshResult = await refreshContestData(params.services.contests, params.scope);
  if ("error" in refreshResult) {
    await params.interaction.editReply(refreshResult.error);
    return { status: "replied" };
  }
  const stale = refreshResult.stale;

  const lookup = await resolveContestOrReply(
    params.interaction,
    params.queryRaw,
    params.scope,
    params.services.contests,
    {
      ...params.lookupOptions,
      maxMatches: params.maxMatches,
      refreshWasStale: stale,
    }
  );
  if (lookup.status === "replied") {
    return { status: "replied" };
  }

  return {
    status: "ok",
    contest: lookup.contest,
    stale,
    targetInputs,
  };
}
