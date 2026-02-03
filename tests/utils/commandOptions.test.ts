import type { APIApplicationCommandSubcommandOption } from "discord.js";
import { SlashCommandBuilder } from "discord.js";

import { addScheduleOptions } from "../../src/utils/commandOptions.js";

test("addScheduleOptions adds the expected schedule fields", () => {
  const builder = new SlashCommandBuilder()
    .setName("schedule")
    .setDescription("schedule")
    .addSubcommand((subcommand) =>
      addScheduleOptions(subcommand.setName("set").setDescription("set"), {
        channelDescription: "Channel",
        roleDescription: "Role",
      })
    );

  const json = builder.toJSON();
  const subcommand = json.options?.[0] as APIApplicationCommandSubcommandOption | undefined;
  const options = subcommand?.options ?? [];
  const names = options.map((option) => option.name);

  expect(subcommand?.name).toBe("set");
  expect(names).toEqual(["channel", "role", "hour_utc", "minute_utc", "utc_offset"]);
});
