/**
 * 커스텀 기술 지표 계산 모듈
 * trading-signals 라이브러리에 없는 지표들을 구현
 */
import { Candle } from "../type";

export class TechnicalIndicators {
  /**
   * VWAP (Volume Weighted Average Price) 계산
   */
  static calculateVWAP(candles: Candle[], period: number = 20): number {
    if (candles.length < period) return 0;

    const recentCandles = candles.slice(-period);
    let totalVolume = 0;
    let totalVolumePrice = 0;

    for (const candle of recentCandles) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume || 0;

      totalVolumePrice += typicalPrice * volume;
      totalVolume += volume;
    }

    return totalVolume > 0 ? totalVolumePrice / totalVolume : 0;
  }

  /**
   * OBV (On Balance Volume) 계산
   */
  static calculateOBV(candles: Candle[]): number[] {
    if (candles.length < 2) return [];

    const obvValues: number[] = [];
    let obv = 0;

    for (let i = 1; i < candles.length; i++) {
      const currentClose = candles[i].close;
      const previousClose = candles[i - 1].close;
      const volume = candles[i].volume || 0;

      if (currentClose > previousClose) {
        obv += volume;
      } else if (currentClose < previousClose) {
        obv -= volume;
      }

      obvValues.push(obv);
    }

    return obvValues;
  }

  /**
   * ADL (Accumulation/Distribution Line) 계산
   */
  static calculateADL(candles: Candle[]): number[] {
    const adlValues: number[] = [];
    let adl = 0;

    for (const candle of candles) {
      const range = candle.high - candle.low;
      if (range === 0) continue;

      const mfMultiplier =
        (candle.close - candle.low - (candle.high - candle.close)) / range;
      const mfVolume = mfMultiplier * (candle.volume || 0);
      adl += mfVolume;
      adlValues.push(adl);
    }

    return adlValues;
  }

  /**
   * 평균 거래량 계산
   */
  static calculateAverageVolume(
    candles: Candle[],
    period: number = 20,
  ): number {
    const volumes = candles.slice(-period).map(c => c.volume || 0);
    return volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
  }

  /**
   * 거래량 강도 분석 (상승/하락 캔들 거래량 비율)
   */
  static analyzeVolumeStrength(candles: Candle[], period: number = 10): number {
    if (candles.length < period) return 50;

    const recentCandles = candles.slice(-period);
    let upVolumeSum = 0;
    let downVolumeSum = 0;

    for (const candle of recentCandles) {
      const volume = candle.volume || 0;
      if (candle.close > candle.open) {
        upVolumeSum += volume;
      } else if (candle.close < candle.open) {
        downVolumeSum += volume;
      }
    }

    const totalVolume = upVolumeSum + downVolumeSum;
    return totalVolume === 0 ? 50 : (upVolumeSum / totalVolume) * 100;
  }

  /**
   * 거래량 기반 매매 강도 점수 계산 (0-100)
   */
  static calculateBuyingSellingSPressure(
    candles: Candle[],
    period: number = 10,
  ): number {
    if (candles.length < period) return 0;

    const recent = candles.slice(-period);
    const upCandles = recent.filter(c => c.close > c.open);
    const downCandles = recent.filter(c => c.close <= c.open);

    const avgUpVolume =
      upCandles.length > 0
        ? upCandles.reduce((sum, c) => sum + (c.volume || 0), 0) /
          upCandles.length
        : 0;

    const avgDownVolume =
      downCandles.length > 0
        ? downCandles.reduce((sum, c) => sum + (c.volume || 0), 0) /
          downCandles.length
        : 1;

    const volumeRatio = avgUpVolume / avgDownVolume;
    return Math.min(100, Math.max(0, 50 * volumeRatio));
  }
}
