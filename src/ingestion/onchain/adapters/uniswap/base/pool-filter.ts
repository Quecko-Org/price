// ============================================================
// pool-filter.ts  — shared by V3 + V4 discovery
// ============================================================
import { TOKEN_ALIAS,QUOTE_ADDRESSES, QUOTE_SYMBOLS } from '@/ingestion/onchain/common/common-tokens';
import { Token } from '@/ingestion/onchain/common/entities/token.entity';

/**
 * Resolve the canonical symbol for priceCache lookup.
 * WETH → ETH, WBTC → BTC, everything else unchanged.
 */
export function canonicalSymbol(token: Token): string {
  return token.canonicalSymbol ?? TOKEN_ALIAS[token.symbol] ?? token.symbol;
}

/**
 * Returns true if this token is a valid quote currency
 * (has a reliable direct USD price from CEX feeds).
 */
export function isQuoteToken(token: Token): boolean {
  return (
    QUOTE_ADDRESSES.has(token.address.toLowerCase()) ||
    QUOTE_SYMBOLS.has(token.symbol) ||
    QUOTE_SYMBOLS.has(token.canonicalSymbol ?? "")
  );
}

/**
 * Returns true if the pool has at least one quote-currency side.
 * Only these pools can be priced in USD without multi-hop routing.
 * Apply this filter in BOTH V3 and V4 discovery before saving.
 */
export function isTrackablePool(t0: Token, t1: Token): boolean {
  return isQuoteToken(t0) || isQuoteToken(t1);
}

/**
 * Returns { base, quote } so the swap handler always knows
 * which side is the price denominator.
 * Stored as `quoteTokenAddress` on the DexPool entity.
 */
export function getPoolSides(
  t0: Token,
  t1: Token,
): { base: Token; quote: Token } | null {
  if (isQuoteToken(t1) && !isQuoteToken(t0)) return { base: t0, quote: t1 };
  if (isQuoteToken(t0) && !isQuoteToken(t1)) return { base: t1, quote: t0 };
  // Both are quote tokens (e.g. USDC/USDT, ETH/USDC) — treat token1 as quote
  if (isQuoteToken(t0) && isQuoteToken(t1)) return { base: t0, quote: t1 };
  return null;
}