export const SHIRT_COLORS = [
  { name: "White", value: "#ffffff" },
  { name: "Black", value: "#0c0c0c" },
  { name: "Dark Grey", value: "#2A2929" },
  { name: "Natural", value: "#fef1d1" },
  { name: "Tan", value: "#ddb792" },
  { name: "Soft Cream", value: "#e7d4c0" },
  { name: "Pebble", value: "#9a8479" },
  { name: "Heather Dust", value: "#e5d9c9" },
  { name: "Vintage White", value: "#fcf4e8" },
  { name: "Aqua", value: "#008db5" },
  { name: "Burnt Orange", value: "#ed8043" },
  { name: "Mustard", value: "#eda027" },
  { name: "Sage", value: "#9eab96" },
] as const;

export type ShirtColorName = (typeof SHIRT_COLORS)[number]["name"];
