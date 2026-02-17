import { EXCHANGE_WEIGHTS } from '../constants/exchanges.constants';
import { ExchangeCandle } from '../types/candle.type';

export function aggregateCandles(
  candles: ExchangeCandle[],
) {
  if (!candles.length) return null;

  let weightSum = 0;
  let open = 0;
  let close = 0;
  let high: number | null = null;
  let low: number | null = null;
  let volume = 0;


  for (const c of candles) {
    if (
      !Number.isFinite(c.open) ||
      !Number.isFinite(c.close) ||
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.volume) ||
      c.volume <= 0
    ) {
      continue;
    }

    const trust = EXCHANGE_WEIGHTS[c.exchange] ?? 0.3;

    // sqrt volume reduces manipulation
    let weight = trust * Math.sqrt(c.volume);
  
    const isLive = Date.now() - c.openTime < 60_000;

    // 🔥 damp early live candles
    if (isLive) weight *= 0.5;

    if (weight <= 0) continue;

    open += c.open * weight;
    close += c.close * weight;

    high = high === null ? c.high : Math.max(high, c.high);
    low = low === null ? c.low : Math.min(low, c.low);

    volume += c.volume;
    weightSum += weight;
  }

  if (!weightSum || high === null || low === null) return null;

  return {
    open: open / weightSum,
    close: close / weightSum,
    high,
    low,
    volume,
  };
}


// export function aggregateCandles(
//   candles: ExchangeCandle[],
// ) {
//   console.log("ddfd",candles)
//   let totalWeight = 0;
//   let open = 0;
//   let close = 0;
//   let high = Number.MIN_SAFE_INTEGER;
//   let low = Number.MAX_SAFE_INTEGER;
//   let volume = 0;

//   for (const c of candles) {
//     const weight = EXCHANGE_WEIGHTS[c.exchange] * c.volume;

//     if (!weight) continue;

//     open += c.open * weight;
//     close += c.close * weight;

//     high = Math.max(high, c.high);
//     low = Math.min(low, c.low);

//     totalWeight += weight;
//     volume += c.volume;
//   }
//   console.log("ddfd",{
//     open: open / totalWeight,
//     close: close / totalWeight,
//     high,
//     low,
//     volume,
//   })
//   return {
//     open: open / totalWeight,
//     close: close / totalWeight,
//     high,
//     low,
//     volume,
//   };

// }

