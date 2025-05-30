/**
 * MeanReversion Strategy
 * 평균 회귀 전략 - 가격이 이동평균에서 많이 벗어났을 때 반대 방향으로 베팅
 */

import { BaseStrategy } from "../base/BaseStrategy";
import { EMA, RSI } from "trading-signals";
import { Candle } from "../type";
import { UpbitClient } from "@/api/upbitClient";

export interface MeanReversionConfig {
  emaPeriod: number;
  deviationThreshold: number; // 이동평균에서 벗어난 임계값 (%)
  rsiPeriod: number;
  rsiOversold: number;
  profitFactor: number;
  stopFactor: number;
}

export class MeanReversion extends BaseStrategy {
  name = "MeanReversion";
  private config: MeanReversionConfig;
  private ema: EMA;
  private rsi: RSI;

  constructor(
    client: UpbitClient,
    config: MeanReversionConfig,
    isBacktest: boolean = false,
  ) {
    super(client, isBacktest);
    this.config = config;
    this.ema = new EMA(this.config.emaPeriod);
    this.rsi = new RSI(this.config.rsiPeriod);
  }

  private updateIndicators(
    fromIndex: number,
    toIndex: number,
    candles: Candle[],
  ): void {
    for (let i = fromIndex; i <= toIndex; i++) {
      const candle = candles[i];
      this.ema.update(candle.close, false);
      this.rsi.update(candle.close, false);
    }
  }

  async shouldEnter(candles: Candle[]): Promise<boolean> {
    if (
      !this.validateCandleData(
        candles,
        Math.max(this.config.emaPeriod, this.config.rsiPeriod) + 5,
      )
    ) {
      return false;
    }

    // 지표 업데이트
    this.updateIndicatorsOptimized(candles, (fromIndex, toIndex) => {
      this.updateIndicators(fromIndex, toIndex, candles);
    });

    const currentPrice = candles[candles.length - 1].close;

    // BaseStrategy의 EMA 계산 활용
    const closePrices = candles.map(c => c.close);
    const emaArray = this.calculateEMA(closePrices, this.config.emaPeriod);
    const currentEma = emaArray.length > 0 ? emaArray[emaArray.length - 1] : 0;

    // BaseStrategy의 RSI 계산 활용
    const rsiArray = this.calculateRSI(closePrices, this.config.rsiPeriod);
    const currentRsi = rsiArray.length > 0 ? rsiArray[rsiArray.length - 1] : 0;

    if (currentEma === 0 || currentRsi === 0) {
      return false;
    }

    // 이동평균에서 벗어난 정도 계산
    const deviation = ((currentPrice - currentEma) / currentEma) * 100;
    const isOversold = deviation <= -this.config.deviationThreshold;

    // RSI 과매도 확인
    const rsiOversold = currentRsi <= this.config.rsiOversold;

    // 거래량 존재 확인
    const hasVolume = (candles[candles.length - 1].volume || 0) > 0;

    // 연속 하락 확인 (2캔들)
    const isDowntrend =
      candles.length >= 2 &&
      candles[candles.length - 1].close < candles[candles.length - 2].close;

    return isOversold && rsiOversold && hasVolume && isDowntrend;
  }

  async shouldExit(candles: Candle[], entryPrice: number): Promise<boolean> {
    const currentPrice = candles[candles.length - 1].close;

    // 수익 실현 (평균 회귀이므로 작은 수익에도 빠르게 청산)
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
      `MeanReversion: ${market} 매수 신호 - 가격: ${
        candles[candles.length - 1].close
      }`,
    );
  }
}
