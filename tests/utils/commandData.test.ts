import { commandData } from "../../src/commands/index.js";
import {
  findCommandOptionOrderIssues,
  normalizeCommandData,
} from "../../src/utils/commandData.js";

type Option = {
  name: string;
  required?: boolean;
  options?: Option[];
};

test("normalizeCommandData preserves valid required option ordering", () => {
  const data = {
    options: [
      { name: "required", required: true },
      { name: "optional", required: false },
      { name: "implicit", required: undefined },
    ],
  };

  const normalized = normalizeCommandData(data);
  const names = normalized.options?.map((option) => option.name);

  expect(names).toEqual(["required", "optional", "implicit"]);
});

test("normalizeCommandData reorders required options before optional ones", () => {
  const data = {
    options: [
      { name: "optional", required: false },
      { name: "required", required: true },
      { name: "optional-2", required: false },
    ],
  };

  const normalized = normalizeCommandData(data);
  const names = normalized.options?.map((option) => option.name);

  expect(names).toEqual(["required", "optional", "optional-2"]);
});

test("normalizeCommandData recurses into nested option arrays", () => {
  const data = {
    options: [
      {
        name: "subcommand",
        options: [
          { name: "optional", required: false },
          { name: "required", required: true },
        ] as Option[],
      },
    ],
  };

  const normalized = normalizeCommandData(data);
  const nestedNames = normalized.options?.[0]?.options?.map((option) => option.name);

  expect(nestedNames).toEqual(["required", "optional"]);
});

test("findCommandOptionOrderIssues reports required options after optional ones", () => {
  const data = {
    name: "test",
    options: [
      { name: "optional", required: false },
      { name: "required", required: true },
    ],
  };

  const issues = findCommandOptionOrderIssues(data);

  expect(issues).toEqual([{ path: "test", optionName: "required" }]);
});

test("commandData has valid required option ordering", () => {
  const issues = commandData.flatMap((command) => findCommandOptionOrderIssues(command));

  expect(issues).toEqual([]);
});
