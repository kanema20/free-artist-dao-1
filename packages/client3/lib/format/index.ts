import { FixedNumber } from "ethers";

// Intl formatters are nice because they are sensitive to the user's device locale. For now they are hard-coded to en-US, but in the future this can be parameterized or even changed into hooks (to get locale from context)

const percentageFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPercent(n: number | FixedNumber) {
  if (n instanceof FixedNumber) {
    return percentageFormatter.format(n.toUnsafeFloat());
  }
  return percentageFormatter.format(n);
}

export * from "./currency-units";
