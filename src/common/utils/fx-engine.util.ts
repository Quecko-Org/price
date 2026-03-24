const fiatRates = new Map<string, number>();   // EUR → USD
const cryptoRates = new Map<string, number>(); // BTC → USD

/* =========================
   FIAT UPDATE
========================= */
export function updateFiatRates(rates: Record<string, number>) {
  for (const [currency, rate] of Object.entries(rates)) {
    if (!rate || rate <= 0) continue;
    fiatRates.set(currency, 1 / Number(rate)); // invert
  }
}

/* =========================
   CRYPTO UPDATE
========================= */
export function updateCryptoPrice(symbol: string, priceUSD: number) {
  if (!priceUSD || priceUSD <= 0) return;
  cryptoRates.set(symbol, priceUSD);
}

/* =========================
   MAIN CONVERSION
========================= */
export function convertToUSD(price: number, quote: string): number | null {
  if (!price || price <= 0) return null;

  // USD direct
  if (quote === 'USD') return price;

  // Stablecoins
  if (['USDT', 'USDC', 'FDUSD', 'TUSD'].includes(quote)) {
    return price;
  }

  // Fiat
  const fiat = fiatRates.get(quote);
  if (fiat) return price * fiat;

  // Crypto
  const crypto = cryptoRates.get(quote);
  if (crypto) return price * crypto;

  return null;
}