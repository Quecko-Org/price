// ============================================================
// pool-filter.ts  — shared by V3 + V4 discovery
// ============================================================
import { CHAIN_CONFIGS, Chain } from '@/ingestion/onchain/common/chain.config';
import { TOKEN_ALIAS,QUOTE_ADDRESSES, QUOTE_SYMBOLS } from '@/ingestion/onchain/common/common-tokens';
import { Token } from '@/ingestion/onchain/common/entities/token.entity';

/**
 * Resolve the canonical symbol for priceCache lookup.
 * WETH → ETH, WBTC → BTC, everything else unchanged.
 */
export function canonicalSymbol(token: Token): string {
  return token.canonicalSymbol ?? TOKEN_ALIAS[token.symbol] ?? token.symbol;
}


// ── Is this token a quote currency? ──────────────────────────
// Uses chain-specific quoteAddresses from CHAIN_CONFIGS when available,
// falls back to QUOTE_SYMBOLS for symbol-based check.
export function isQuoteToken(token: Token, chainId?: Chain): boolean {
  const addr = token.address.toLowerCase();
 
  // Chain-specific address check (most precise)
  if (chainId !== undefined && CHAIN_CONFIGS[chainId]) {
    if (CHAIN_CONFIGS[chainId].quoteAddresses.has(addr)) return true;
  }
 
  // Symbol-based fallback
  return (
    QUOTE_SYMBOLS.has(token.symbol) ||
    QUOTE_SYMBOLS.has(token.canonicalSymbol ?? '')
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
  token0:  Token,
  token1:  Token,
  chainId?: Chain,
): { base: Token; quote: Token } | null {
  const t0IsQuote = isQuoteToken(token0, chainId);
  const t1IsQuote = isQuoteToken(token1, chainId);
  if (!t0IsQuote && !t1IsQuote) return null; // neither is a known quote — skip


  // //wbtc pepe
  // if (isQuoteToken(t1) && !isQuoteToken(t0)) return { base: t0, quote: t1 };
  // if (isQuoteToken(t0) && !isQuoteToken(t1)) return { base: t1, quote: t0 };
  // // Both are quote tokens (e.g. USDC/USDT, ETH/USDC) — treat token1 as quote
  // if (isQuoteToken(t0) && isQuoteToken(t1)) return { base: t0, quote: t1 };
  return null;
}