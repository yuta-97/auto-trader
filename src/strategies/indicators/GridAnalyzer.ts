/**
 * 그리드 분석 모듈
 * 지지/저항 레벨과 거래량 프로파일 분석
 */
import { Candle } from "../type";

export interface GridLevels {
  supports: number[];
  resistances: number[];
  keyLevels: number[];
  volumeNodes: number[];
}

export interface GridConfig {
  gridCount: number;
  minRangePct: number;
  volatilityThreshold: number;
  gridStepMultiplier: number;
  volumeAnalysisPeriod: number;
  volumeTrendPeriod: number;
  volumeEfficiencyThreshold: number;
}

export class GridAnalyzer {
  private config: GridConfig;

  constructor(config: GridConfig) {
    this.config = config;
  }

  /**
   * 지지/저항 레벨 찾기
   */
  findSupportResistanceLevels(candles: Candle[]): GridLevels {
    if (candles.length < 30) {
      return { supports: [], resistances: [], keyLevels: [], volumeNodes: [] };
    }

    const priceMap = new Map<number, number>();
    const pricePrecision = 2;

    // 가격대별 터치 횟수 계산
    candles.forEach(candle => {
      const highRound =
        Math.round(candle.high * Math.pow(10, pricePrecision)) /
        Math.pow(10, pricePrecision);
      const lowRound =
        Math.round(candle.low * Math.pow(10, pricePrecision)) /
        Math.pow(10, pricePrecision);

      priceMap.set(highRound, (priceMap.get(highRound) || 0) + 1);
      priceMap.set(lowRound, (priceMap.get(lowRound) || 0) + 1);
    });

    // 터치 횟수 기준으로 정렬하여 주요 레벨 선정
    const sortedPrices = Array.from(priceMap.entries()).sort(
      (a, b) => b[1] - a[1],
    );
    const topCount = Math.max(3, Math.floor(sortedPrices.length * 0.3));
    const keyLevels = sortedPrices
      .slice(0, topCount)
      .map(item => item[0])
      .sort((a, b) => a - b);

    const latestPrice = candles.at(-1).close;
    const supports = keyLevels.filter(price => price < latestPrice);
    const resistances = keyLevels.filter(price => price > latestPrice);
    const volumeNodes = this.findVolumeNodes(candles);

    return { supports, resistances, keyLevels, volumeNodes };
  }

  /**
   * 거래량 프로파일 기반 주요 가격대 식별
   */
  private findVolumeNodes(candles: Candle[]): number[] {
    if (candles.length < 20) return [];

    const volumeProfile = this.createVolumeProfile(candles);
    const totalVolume = Array.from(volumeProfile.values()).reduce(
      (sum, vol) => sum + vol,
      0,
    );
    const averageVolume = totalVolume / volumeProfile.size;

    return Array.from(volumeProfile.entries())
      .filter(([_, volume]) => volume > averageVolume * 1.5)
      .map(([price, _]) => price)
      .sort((a, b) => a - b);
  }

  /**
   * 거래량 프로파일 생성
   */
  private createVolumeProfile(candles: Candle[]): Map<number, number> {
    const volumeProfile = new Map<number, number>();
    const pricePrecision = 2;

    candles.forEach(candle => {
      const priceRange = candle.high - candle.low;
      const volume = candle.volume || 0;

      if (priceRange === 0) {
        const price =
          Math.round(candle.close * Math.pow(10, pricePrecision)) /
          Math.pow(10, pricePrecision);
        volumeProfile.set(price, (volumeProfile.get(price) || 0) + volume);
      } else {
        const steps = 10;
        const stepSize = priceRange / steps;
        const volumePerStep = volume / steps;

        for (let i = 0; i < steps; i++) {
          const price = candle.low + (i + 0.5) * stepSize;
          const roundedPrice =
            Math.round(price * Math.pow(10, pricePrecision)) /
            Math.pow(10, pricePrecision);
          volumeProfile.set(
            roundedPrice,
            (volumeProfile.get(roundedPrice) || 0) + volumePerStep,
          );
        }
      }
    });

    return volumeProfile;
  }

  /**
   * 변동성 계산
   */
  calculateVolatility(candles: Candle[]): number {
    if (candles.length < this.config.volumeAnalysisPeriod) return 1;

    const recentCandles = candles.slice(-this.config.volumeAnalysisPeriod);
    const returns = recentCandles
      .slice(1)
      .map(
        (candle, i) =>
          (candle.close - recentCandles[i].close) / recentCandles[i].close,
      );

    const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance =
      returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) /
      returns.length;

    return Math.sqrt(variance) * Math.sqrt(365); // 연환산
  }

  /**
   * 박스권 여부 판단
   */
  isInSidewaysTrend(candles: Candle[], atrValue: number): boolean {
    const volatility = this.calculateVolatility(candles);
    const latestPrice = candles.at(-1).close;
    const atrPercent = (atrValue / latestPrice) * 100;

    return (
      volatility < this.config.volatilityThreshold &&
      atrPercent > this.config.minRangePct
    );
  }

  /**
   * 거래량 추세 분석
   */
  analyzeVolumeTrend(candles: Candle[]): {
    isVolumeTrendUp: boolean;
    volumeRatio: number;
  } {
    if (candles.length < this.config.volumeTrendPeriod * 2) {
      return { isVolumeTrendUp: false, volumeRatio: 1 };
    }

    const recent = candles.slice(-this.config.volumeTrendPeriod);
    const previous = candles.slice(
      -this.config.volumeTrendPeriod * 2,
      -this.config.volumeTrendPeriod,
    );

    const recentVolume =
      recent.reduce((sum, c) => sum + (c.volume || 0), 0) / recent.length;
    const previousVolume =
      previous.reduce((sum, c) => sum + (c.volume || 0), 0) / previous.length;

    const volumeRatio = previousVolume > 0 ? recentVolume / previousVolume : 1;

    return {
      isVolumeTrendUp: volumeRatio > 1.1,
      volumeRatio,
    };
  }

  /**
   * 그리드 간격 계산
   */
  calculateGridSpacing(atrValue: number, currentPrice: number): number {
    return Math.max(
      atrValue * this.config.gridStepMultiplier,
      currentPrice * (this.config.minRangePct / 100),
    );
  }
}
