import { EXCHANGE_WEIGHTS } from "../constants/exchanges.constants";
import { ExchangeCandle } from "../types/candle.type";

function median(values: number[]) {
  const sorted = [...values].sort((a,b)=>a-b);
  const mid = Math.floor(sorted.length/2);

  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid-1] + sorted[mid]) / 2;
}

export function aggregateCandles(candles: ExchangeCandle[]) {

  if (!candles.length) return null;

  // 1️⃣ Validate candles
  const valid = candles.filter(c =>
    Number.isFinite(c.open) &&
    Number.isFinite(c.close) &&
    Number.isFinite(c.high) &&
    Number.isFinite(c.low) &&
    Number.isFinite(c.volume) &&
    c.volume > 0
  );

  if (!valid.length) return null;

  // 2️⃣ Median price
  const closes = valid.map(c => c.close);
  const medianPrice = median(closes);

  // 3️⃣ Remove outliers (±5%)
  const filtered = valid.filter(c => {
    const diff = Math.abs(c.close - medianPrice) / medianPrice;
    return diff < 0.05;
  });

  if (!filtered.length) return null;

  // 4️⃣ Sort by time
  filtered.sort((a,b)=>a.openTime - b.openTime);

  let high = -Infinity;
  let low = Infinity;
  let volume = 0;

  let weightedCloseSum = 0;
  let weightSum = 0;

  const open = filtered[0].open;
  const close = filtered[filtered.length-1].close;

  for (const c of filtered) {

    const trust = EXCHANGE_WEIGHTS[c.exchange] ?? 0.3;

    const liquidityWeight = Math.sqrt(c.volume);

    const weight = trust * liquidityWeight;

    high = Math.max(high, c.high);
    low = Math.min(low, c.low);

    volume += c.volume;

    weightedCloseSum += c.close * weight;
    weightSum += weight;
  }

  const weightedClose = weightSum
    ? weightedCloseSum / weightSum
    : close;

  return {
    open,
    high,
    low,
    close,
    volume,
    weightedClose
  };
}


















// try this if above not working




// import { EXCHANGE_WEIGHTS } from "../constants/exchanges.constants";
// import { ExchangeCandle } from "../types/candle.type";

// export function aggregateCandles(candles: ExchangeCandle[]) {
//   if (!candles.length) return null;

//   // Filter valid candles
//   const valid = candles
//     .filter(c =>
//       Number.isFinite(c.open) &&
//       Number.isFinite(c.close) &&
//       Number.isFinite(c.high) &&
//       Number.isFinite(c.low) &&
//       Number.isFinite(c.volume) &&
//       c.volume > 0,
//     )
//     .sort((a, b) => a.openTime - b.openTime); // chronological

//   if (!valid.length) return null;

//   let high = -Infinity;
//   let low = Infinity;
//   let volume = 0;
//   let weightedCloseSum = 0;
//   let weightSum = 0;

//   // Open is first candle, Close is last candle
//   const open = valid[0].open;
//   const close = valid[valid.length - 1].close;

//   for (const c of valid) {
//     const trust = EXCHANGE_WEIGHTS[c.exchange] ?? 0.3;
//     const weight = trust * Math.sqrt(c.volume);
 
//     high = Math.max(high, c.high);
//     low = Math.min(low, c.low);

//     volume += c.volume;
//     weightedCloseSum += c.close * weight;
//     weightSum += weight;
//   }

//   return {
//     open,
//     high,
//     low,
//     close,
//     volume,
//     weightedClose: weightSum ? weightedCloseSum / weightSum : close, // VWAP style
//   };
// }











//2nd one 

// import { EXCHANGE_WEIGHTS } from "../constants/exchanges.constants";
// import { ExchangeCandle } from "../types/candle.type";

// export function aggregateCandles(candles: ExchangeCandle[]) {
//   if (!candles.length) return null;

//   const valid = candles.filter(c =>
//     Number.isFinite(c.open) &&
//     Number.isFinite(c.close) &&
//     Number.isFinite(c.high) &&
//     Number.isFinite(c.low) &&
//     Number.isFinite(c.volume) &&
//     c.volume > 0,
//   );

//   if (!valid.length) return null;

//   let weightSum = 0;
//   let open = 0;
//   let close = 0;
//   let high = -Infinity;
//   let low = Infinity;
//   let volume = 0;

//   for (const c of valid) {
//     const trust = EXCHANGE_WEIGHTS[c.exchange] ?? 0.3;

//     const weight = trust * Math.sqrt(c.volume);

//     open += c.open * weight;
//     close += c.close * weight;

//     high = Math.max(high, c.high);
//     low = Math.min(low, c.low);

//     volume += c.volume;
//     weightSum += weight;
//   }

//   if (!weightSum) return null;

//   return {
//     open: open / weightSum,
//     close: close / weightSum,
//     high,
//     low,
//     volume,
//   };
// }







// import { EXCHANGE_WEIGHTS } from '../constants/exchanges.constants';
// import { ExchangeCandle } from '../types/candle.type';

// export function aggregateCandles(
//   candles: ExchangeCandle[],
// ) {
//   if (!candles.length) return null;

//   let weightSum = 0;
//   let open = 0;
//   let close = 0;
//   let high: number | null = null;
//   let low: number | null = null;
//   let volume = 0;


//   for (const c of candles) {
//     if (
//       !Number.isFinite(c.open) ||
//       !Number.isFinite(c.close) ||
//       !Number.isFinite(c.high) ||
//       !Number.isFinite(c.low) ||
//       !Number.isFinite(c.volume) ||
//       c.volume <= 0
//     ) {
//       continue;
//     }

//     const trust = EXCHANGE_WEIGHTS[c.exchange] ?? 0.3;

//     // sqrt volume reduces manipulation
//     let weight = trust * Math.sqrt(c.volume);
  
//     const isLive = Date.now() - c.openTime < 60_000;

//     // 🔥 damp early live candles
//     if (isLive) weight *= 0.5;

//     if (weight <= 0) continue;

//     open += c.open * weight;
//     close += c.close * weight;

//     high = high === null ? c.high : Math.max(high, c.high);
//     low = low === null ? c.low : Math.min(low, c.low);

//     volume += c.volume;
//     weightSum += weight;
//   }

//   if (!weightSum || high === null || low === null) return null;

//   return {
//     open: open / weightSum,
//     close: close / weightSum,
//     high,
//     low,
//     volume,
//   };
// }


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

