import {
  ChannelType,
  type SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
  type SlashCommandSubcommandBuilder,
} from "discord.js";

import { addContestScopeOption } from "./contestScope.js";

type ScheduleOptionText = {
  channelDescription: string;
  roleDescription: string;
};

export function addScheduleOptions(
  subcommand: SlashCommandSubcommandBuilder,
  text: ScheduleOptionText
): SlashCommandSubcommandBuilder {
  return subcommand
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription(text.channelDescription)
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .addRoleOption((option) => option.setName("role").setDescription(text.roleDescription))
    .addIntegerOption((option) =>
      option
        .setName("hour_utc")
        .setDescription("Hour to post (uses utc_offset if set; defaults to UTC)")
        .setMinValue(0)
        .setMaxValue(23)
    )
    .addIntegerOption((option) =>
      option
        .setName("minute_utc")
        .setDescription("Minute to post (uses utc_offset if set; defaults to UTC)")
        .setMinValue(0)
        .setMaxValue(59)
    )
    .addStringOption((option) =>
      option.setName("utc_offset").setDescription("UTC offset for local time (e.g. +02:00, -05:30, Z)")
    );
}

export function addRatingRangeOptions(
  builder: SlashCommandBuilder
): SlashCommandOptionsOnlyBuilder;
export function addRatingRangeOptions(
  builder: SlashCommandSubcommandBuilder
): SlashCommandSubcommandBuilder;
export function addRatingRangeOptions(
  builder: SlashCommandBuilder | SlashCommandSubcommandBuilder
): SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandBuilder {
  return builder
    .addIntegerOption((option) =>
      option.setName("rating").setDescription("Exact problem rating").setMinValue(0)
    )
    .addIntegerOption((option) =>
      option.setName("min_rating").setDescription("Minimum rating").setMinValue(0)
    )
    .addIntegerOption((option) =>
      option.setName("max_rating").setDescription("Maximum rating").setMinValue(0)
    )
    .addStringOption((option) =>
      option.setName("ranges").setDescription("Rating ranges (e.g. 800-1200, 1400, 1600-1800)")
    );
}

export function addTagOptions(
  builder: SlashCommandBuilder
): SlashCommandOptionsOnlyBuilder;
export function addTagOptions(
  builder: SlashCommandOptionsOnlyBuilder
): SlashCommandOptionsOnlyBuilder;
export function addTagOptions(
  builder: SlashCommandSubcommandBuilder
): SlashCommandSubcommandBuilder;
export function addTagOptions(
  builder: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandBuilder
): SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandBuilder {
  return builder.addStringOption((option) =>
    option.setName("tags").setDescription("Problem tags (e.g. dp, greedy, -math)")
  );
}

export function addContestFilterOptions(
  builder: SlashCommandBuilder
): SlashCommandOptionsOnlyBuilder;
export function addContestFilterOptions(
  builder: SlashCommandOptionsOnlyBuilder,
  scopeDescription?: string
): SlashCommandOptionsOnlyBuilder;
export function addContestFilterOptions(
  builder: SlashCommandSubcommandBuilder,
  scopeDescription?: string
): SlashCommandSubcommandBuilder;
export function addContestFilterOptions(
  builder: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandBuilder,
  scopeDescription = "Which contests to show"
): SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandBuilder {
  return builder
    .addStringOption((option) =>
      option.setName("include").setDescription("Only show contests matching keywords (comma-separated)")
    )
    .addStringOption((option) =>
      option.setName("exclude").setDescription("Hide contests matching keywords (comma-separated)")
    )
    .addStringOption((option) => addContestScopeOption(option, scopeDescription));
}

export function addCleanupIncludePermissionsOption(
  subcommand: SlashCommandSubcommandBuilder,
  description = "Also remove if the bot is missing channel permissions"
): SlashCommandSubcommandBuilder {
  return subcommand.addBooleanOption((option) =>
    option.setName("include_permissions").setDescription(description)
  );
}

export function addCleanupSubcommand(
  subcommand: SlashCommandSubcommandBuilder,
  description: string,
  includePermissionsDescription?: string
): SlashCommandSubcommandBuilder {
  const withDetails = subcommand.setName("cleanup").setDescription(description);
  return addCleanupIncludePermissionsOption(withDetails, includePermissionsDescription);
}

export function addPostSubcommand(
  subcommand: SlashCommandSubcommandBuilder,
  options: {
    description: string;
    forceDescription?: string;
    idDescription?: string;
  }
): SlashCommandSubcommandBuilder {
  const builder = subcommand.setName("post").setDescription(options.description);
  addOptionalBooleanOption(builder, "force", options.forceDescription);
  addOptionalStringOption(builder, "id", options.idDescription);
  return builder;
}

export function addPreviewSubcommand(
  subcommand: SlashCommandSubcommandBuilder,
  options: {
    description: string;
    idDescription?: string;
  }
): SlashCommandSubcommandBuilder {
  const builder = subcommand.setName("preview").setDescription(options.description);
  addOptionalStringOption(builder, "id", options.idDescription);
  return builder;
}

function addOptionalBooleanOption(
  builder: SlashCommandSubcommandBuilder,
  name: string,
  description?: string
): SlashCommandSubcommandBuilder {
  if (!description) {
    return builder;
  }
  return builder.addBooleanOption((option) =>
    option.setName(name).setDescription(description)
  );
}

function addOptionalStringOption(
  builder: SlashCommandSubcommandBuilder,
  name: string,
  description?: string
): SlashCommandSubcommandBuilder {
  if (!description) {
    return builder;
  }
  return builder.addStringOption((option) =>
    option.setName(name).setDescription(description)
  );
}

export function addPageOption(
  builder: SlashCommandBuilder
): SlashCommandOptionsOnlyBuilder;
export function addPageOption(
  builder: SlashCommandOptionsOnlyBuilder
): SlashCommandOptionsOnlyBuilder;
export function addPageOption(
  builder: SlashCommandSubcommandBuilder
): SlashCommandSubcommandBuilder;
export function addPageOption(
  builder: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandBuilder
): SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandBuilder {
  return builder.addIntegerOption((option) =>
    option.setName("page").setDescription("Page number (starting at 1)").setMinValue(1)
  );
}
