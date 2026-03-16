import { csvParse } from "d3";
import { derived, writable } from "svelte/store";

export const GROUPING_OPTIONS = [
  {
    value: "innovation-stream",
    label: "Innovation Stream",
    aliases: ["innovationstream"],
  },
  {
    value: "external-internal-activity",
    label: "External/Internal Activity",
    aliases: [
      "externalinternalactivity",
      "externalinternal",
      "externalorinternalactivity",
    ],
  },
  {
    value: "academic-lead",
    label: "Academic Lead",
    aliases: ["academiclead"],
  },
  {
    value: "ps-lead",
    label: "PS Lead",
    aliases: ["pslead"],
  },
  {
    value: "status",
    label: "Status",
    aliases: ["status"],
  },
];

const UNASSIGNED_LABEL = "Unassigned";

const records = writable([]);
export const selectedGrouping = writable(GROUPING_OPTIONS[0].value);
export const sourceLabel = writable("activities.csv");
export const uploadError = writable("");
export const isLoading = writable(false);

export const groupedActivities = derived(
  [records, selectedGrouping],
  ([$records, $selectedGrouping]) =>
    aggregateActivitiesByGrouping($records, $selectedGrouping),
);

export async function loadDefaultCsv() {
  isLoading.set(true);
  uploadError.set("");

  try {
    const response = await fetch("/activities.csv");
    if (!response.ok) {
      throw new Error(
        `Could not load activities.csv (HTTP ${response.status}).`,
      );
    }

    const csvText = await response.text();
    const parsedRecords = buildRowsFromCsvText(csvText);
    records.set(parsedRecords);
    sourceLabel.set("activities.csv");
  } catch (error) {
    records.set([]);
    uploadError.set(
      error instanceof Error
        ? error.message
        : "The activities CSV could not be loaded.",
    );
  } finally {
    isLoading.set(false);
  }
}

export async function loadCsvFile(file) {
  if (!file) {
    return;
  }

  isLoading.set(true);
  uploadError.set("");

  try {
    const csvText = await file.text();
    const parsedRecords = buildRowsFromCsvText(csvText);
    records.set(parsedRecords);
    sourceLabel.set(file.name);
  } catch (error) {
    uploadError.set(
      error instanceof Error
        ? error.message
        : "The selected file could not be parsed.",
    );
  } finally {
    isLoading.set(false);
  }
}

function buildRowsFromCsvText(csvText) {
  const rows = csvParse(csvText);
  const columns = rows.columns ?? [];

  if (!columns.length) {
    throw new Error("CSV is empty. Add at least an Activity column.");
  }

  const activityColumn = findColumn(columns, ["activity", "activities"]);
  if (!activityColumn) {
    throw new Error("No Activity column found. Expected a column named Activity.");
  }

  const groupingColumnsByValue = new Map(
    GROUPING_OPTIONS.map((option) => [
      option.value,
      findColumn(columns, option.aliases) ?? null,
    ]),
  );

  const parsed = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const name = String(row[activityColumn] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!name) {
      continue;
    }

    const groups = {};
    for (const option of GROUPING_OPTIONS) {
      const columnName = groupingColumnsByValue.get(option.value);
      const groupValue = columnName ? row[columnName] : "";
      groups[option.value] = normalizeGroupLabel(groupValue);
    }

    parsed.push({
      id: buildActivityId(index, name),
      name,
      value: 1,
      groups,
    });
  }

  if (!parsed.length) {
    throw new Error(
      "No rows with valid Activity values were found.",
    );
  }

  return parsed;
}

function normalizeGroupLabel(value) {
  const label = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  return label || UNASSIGNED_LABEL;
}

function aggregateActivitiesByGrouping(items, groupingValue) {
  const groups = new Map();

  for (const item of items) {
    const groupLabel = item.groups[groupingValue] || UNASSIGNED_LABEL;

    if (!groups.has(groupLabel)) {
      groups.set(groupLabel, []);
    }

    groups.get(groupLabel).push({
      id: item.id,
      name: item.name,
      value: item.value,
    });
  }

  return [...groups.entries()]
    .map(([label, activities]) => ({
      key: buildGroupId(label),
      label,
      totalValue: activities.length,
      activities,
    }))
    .sort((a, b) => b.totalValue - a.totalValue || a.label.localeCompare(b.label));
}

function buildActivityId(index, activityName) {
  const normalized = normalizeHeader(activityName) || "activity";
  return `${normalized}:${index}`;
}

function buildGroupId(label) {
  const normalized = normalizeHeader(label) || "unassigned";
  return `${normalized}:${hashString(label)}`;
}

function hashString(value) {
  let hash = 0;

  for (const char of String(value)) {
    hash = (hash << 5) - hash + char.charCodeAt(0);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

function findColumn(columns, aliases) {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  return columns.find((column) =>
    normalizedAliases.has(normalizeHeader(column)),
  );
}

function normalizeHeader(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
