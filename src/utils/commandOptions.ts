import { ChannelType, type SlashCommandSubcommandBuilder } from "discord.js";

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
