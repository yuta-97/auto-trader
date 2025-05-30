/**
 * MomentumBreak Strategy
 * 단순 모멘텀 돌파 전략 - 짧은 기간 EMA가 긴 기간 EMA를 상향 돌파할 때 매수
 */

import { BaseStrategy } from "../base/BaseStrategy";
import { EMA } from "trading-signals";
import { Candle } from "../type";
import { UpbitClient } from "@/api/upbitClient";

export interface MomentumBreakConfig {
  shortEmaPeriod: number;
  longEmaPeriod: number;
  minPriceChange: number; // 최소 가격 변화율 (%)
  profitFactor: number;
  stopFactor: number;
}

export class MomentumBreak extends BaseStrategy {
  name = "MomentumBreak";
  private config: MomentumBreakConfig;
  private shortEma: EMA;
  private longEma: EMA;

  constructor(
    client: UpbitClient,
    config: MomentumBreakConfig,
    isBacktest: boolean = false,
  ) {
    super(client, isBacktest);
    this.config = config;
    this.shortEma = new EMA(this.config.shortEmaPeriod);
    this.longEma = new EMA(this.config.longEmaPeriod);
  }

  private updateIndicators(
    fromIndex: number,
    toIndex: number,
    candles: Candle[],
  ): void {
    for (let i = fromIndex; i <= toIndex; i++) {
      const candle = candles[i];
      this.shortEma.update(candle.close, false);
      this.longEma.update(candle.close, false);
    }
  }

  async shouldEnter(candles: Candle[]): Promise<boolean> {
    if (
      !this.validateCandleData(
        candles,
        Math.max(this.config.shortEmaPeriod, this.config.longEmaPeriod) + 2,
      )
    ) {
      return false;
    }

    // 지표 업데이트
    this.updateIndicatorsOptimized(candles, (fromIndex, toIndex) => {
      this.updateIndicators(fromIndex, toIndex, candles);
    });

    const currentShortEma = Number(this.shortEma.getResult() || 0);
    const currentLongEma = Number(this.longEma.getResult() || 0);

    if (currentShortEma === 0 || currentLongEma === 0) {
      return false;
    }

    // 간단한 골든크로스 확인: 현재 short EMA가 long EMA보다 높으면 OK
    const goldenCross = currentShortEma > currentLongEma;

    // 최소 가격 변화율 확인
    const current = candles.length - 1;
    const previous = current - 1;
    const priceChange =
      ((candles[current].close - candles[previous].close) /
        candles[previous].close) *
      100;
    const hasMinPriceChange = priceChange >= this.config.minPriceChange;

    // 거래량 존재 확인
    const hasVolume = (candles[current].volume || 0) > 0;

    return goldenCross && hasMinPriceChange && hasVolume;
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
    // 기본 실행 로직 (실제 거래는 백테스트에서 처리)
    console.log(
      `MomentumBreak: ${market} 매수 신호 - 가격: ${
        candles[candles.length - 1].close
      }`,
    );
  }
}
