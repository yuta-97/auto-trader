/**
 * VolumeSpike Strategy
 * 거래량 급증 전략 - 평균 거래량의 몇 배 이상일 때 매수
 */

import { BaseStrategy } from "../base/BaseStrategy";
import { EMA } from "trading-signals";
import { Candle } from "../type";
import { UpbitClient } from "@/api/upbitClient";

export interface VolumeSpikeConfig {
  volumeEmaPeriod: number;
  volumeSpikeMultiplier: number; // 평균 거래량의 몇 배
  priceEmaPeriod: number;
  minPriceGain: number; // 최소 가격 상승률 (%)
  profitFactor: number;
  stopFactor: number;
}

export class VolumeSpike extends BaseStrategy {
  name = "VolumeSpike";
  private config: VolumeSpikeConfig;
  private volumeEma: EMA;
  private priceEma: EMA;

  constructor(client: UpbitClient, config: VolumeSpikeConfig) {
    super(client);
    this.config = config;
    this.volumeEma = new EMA(this.config.volumeEmaPeriod);
    this.priceEma = new EMA(this.config.priceEmaPeriod);
  }

  private updateIndicators(
    fromIndex: number,
    toIndex: number,
    candles: Candle[],
  ): void {
    for (let i = fromIndex; i <= toIndex; i++) {
      const candle = candles[i];
      this.volumeEma.update(candle.volume || 0, false);
      this.priceEma.update(candle.close, false);
    }
  }

  async shouldEnter(candles: Candle[]): Promise<boolean> {
    if (
      candles.length <
      Math.max(this.config.volumeEmaPeriod, this.config.priceEmaPeriod) + 5
    ) {
      return false;
    }

    // 지표 업데이트
    this.updateIndicatorsOptimized(candles, (fromIndex, toIndex) => {
      this.updateIndicators(fromIndex, toIndex, candles);
    });

    const currentVolume = candles[candles.length - 1].volume || 0;
    const currentPrice = candles[candles.length - 1].close;

    const avgVolume = Number(this.volumeEma.getResult() || 0);
    const currentPriceEma = Number(this.priceEma.getResult() || 0);

    if (avgVolume === 0 || currentPriceEma === 0) {
      return false;
    }

    // 거래량 급증 확인
    const volumeSpike =
      currentVolume >= avgVolume * this.config.volumeSpikeMultiplier;

    // 가격이 EMA 위에 있고 상승 중인지 확인
    const priceAboveEma = currentPrice > currentPriceEma;

    // 최근 가격 상승 확인
    const priceGain =
      candles.length >= 2
        ? ((currentPrice - candles[candles.length - 2].close) /
            candles[candles.length - 2].close) *
          100
        : 0;
    const hasMinPriceGain = priceGain >= this.config.minPriceGain;

    // 기본 조건 확인
    const hasVolume = currentVolume > 0;

    return volumeSpike && priceAboveEma && hasMinPriceGain && hasVolume;
  }

  async shouldExit(candles: Candle[], entryPrice: number): Promise<boolean> {
    const currentPrice = candles[candles.length - 1].close;

    // 수익 실현
    const profitTarget = entryPrice * (1 + this.config.profitFactor / 100);
    if (currentPrice >= profitTarget) {
      return true;
    }

    // 손절
    const stopLoss = entryPrice * (1 - this.config.stopFactor / 100);
    if (currentPrice <= stopLoss) {
      return true;
    }

    return false;
  }

  async execute(
    market: string,
    volume: number,
    candles: Candle[],
  ): Promise<void> {
    console.log(
      `VolumeSpike: ${market} 매수 신호 - 가격: ${
        candles[candles.length - 1].close
      }`,
    );
  }
}
