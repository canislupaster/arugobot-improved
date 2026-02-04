import type { APIApplicationCommandSubcommandOption } from "discord.js";
import { SlashCommandBuilder } from "discord.js";

import {
  addContestFilterOptions,
  addCleanupSubcommand,
  addPageOption,
  addPostSubcommand,
  addRatingRangeOptions,
  addScheduleOptions,
  addTagOptions,
} from "../../src/utils/commandOptions.js";

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

test("addRatingRangeOptions adds rating inputs and ranges", () => {
  const builder = addRatingRangeOptions(
    new SlashCommandBuilder().setName("ratings").setDescription("ratings")
  );

  const json = builder.toJSON();
  const names = json.options?.map((option) => option.name);

  expect(names).toEqual(["rating", "min_rating", "max_rating", "ranges"]);
});

test("addTagOptions adds tags input", () => {
  const builder = addTagOptions(
    new SlashCommandBuilder().setName("tags").setDescription("tags")
  );

  const json = builder.toJSON();
  const names = json.options?.map((option) => option.name);

  expect(names).toEqual(["tags"]);
});

test("addContestFilterOptions adds include/exclude/scope", () => {
  const builder = addContestFilterOptions(
    new SlashCommandBuilder().setName("contests").setDescription("contests"),
    "Scope"
  );

  const json = builder.toJSON();
  const names = json.options?.map((option) => option.name);

  expect(names).toEqual(["include", "exclude", "scope"]);
});

test("addPageOption adds page input", () => {
  const builder = addPageOption(
    new SlashCommandBuilder().setName("pages").setDescription("pages")
  );

  const json = builder.toJSON();
  const names = json.options?.map((option) => option.name);

  expect(names).toEqual(["page"]);
});

test("addCleanupSubcommand adds cleanup with include_permissions", () => {
  const builder = new SlashCommandBuilder()
    .setName("cleanup")
    .setDescription("cleanup")
    .addSubcommand((subcommand) =>
      addCleanupSubcommand(subcommand, "Cleanup subscriptions")
    );

  const json = builder.toJSON();
  const subcommand = json.options?.[0] as APIApplicationCommandSubcommandOption | undefined;
  const options = subcommand?.options ?? [];

  expect(subcommand?.name).toBe("cleanup");
  expect(options.map((option) => option.name)).toEqual(["include_permissions"]);
});

test("addPostSubcommand adds force and id options when provided", () => {
  const builder = new SlashCommandBuilder()
    .setName("postable")
    .setDescription("postable")
    .addSubcommand((subcommand) =>
      addPostSubcommand(subcommand, {
        description: "Post now",
        forceDescription: "Force post",
        idDescription: "Subscription id",
      })
    );

  const json = builder.toJSON();
  const subcommand = json.options?.[0] as APIApplicationCommandSubcommandOption | undefined;
  const options = subcommand?.options ?? [];

  expect(subcommand?.name).toBe("post");
  expect(subcommand?.description).toBe("Post now");
  expect(options.map((option) => option.name)).toEqual(["force", "id"]);
});
