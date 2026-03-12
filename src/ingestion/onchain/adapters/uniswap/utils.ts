import { BigNumberish } from "ethers";

export function sqrtPriceX96ToPrice(
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number,
): number {
  const numerator = Number(sqrtPriceX96) ** 2;
  const denominator = 2 ** 192;

  const rawPrice = numerator / denominator;

  const decimalAdjustment = 10 ** (decimals0 - decimals1);

  return rawPrice * decimalAdjustment;
}
