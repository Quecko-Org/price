export function intervalTable(interval: string): string {

    switch (interval) {
      case '1m':
        return 'aggregated_candles_1m';
  
      case '5m':
        return 'candles_5m';
  
      case '15m':
        return 'candles_15m';
  
      case '1w':
        return 'candles_1w';
  
      case '1h':
        return 'candles_1h';
  
      case '4h':
        return 'candles_4h';
  
      case '1d':
        return 'candles_1d';

      case '1M':
            return 'candles_1m';
  
      default:
        throw new Error('Unsupported interval');
    }
  }