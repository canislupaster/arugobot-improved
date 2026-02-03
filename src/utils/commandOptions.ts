import {
  ChannelType,
  type SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
  type SlashCommandSubcommandBuilder,
} from "discord.js";

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
