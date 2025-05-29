import { RSI, BollingerBands, ATR } from "trading-signals";
import { Candle } from "../type";
import { UpbitClient } from "@/api/upbitClient";
import { BaseStrategy } from "../base/BaseStrategy";

export interface RsiBollingerConfig {
  rsiPeriod: number;
  rsiOversold: number;
  bbPeriod: number;
  bbStdDev: number;
  profitFactorMin: number;
  atrMultiplierProfit: number;
  atrMultiplierStop: number;
}

export class RsiBollinger extends BaseStrategy {
  name = "RSI·볼린저 역추세 (단순화)";

  private config: RsiBollingerConfig;

  // 지표 인스턴스
  private rsi: RSI;
  private bb: BollingerBands;
  private atr: ATR;

  constructor(client: UpbitClient, config?: Partial<RsiBollingerConfig>) {
    super(client);

    // 기본 설정 (거래량 의존성 제거, 조건 완화)
    this.config = {
      rsiPeriod: 14,
      rsiOversold: 50, // 45 → 50으로 더 완화
      bbPeriod: 20,
      bbStdDev: 1.2, // 1.5 → 1.2로 더 완화 (볼린저밴드를 더 좁게)
      profitFactorMin: 1.2,
      atrMultiplierProfit: 2,
      atrMultiplierStop: 1,
      ...config,
    };

    // 지표 초기화
    this.rsi = new RSI(this.config.rsiPeriod);
    this.bb = new BollingerBands(this.config.bbPeriod, this.config.bbStdDev);
    this.atr = new ATR(14);
  }

  /**
   * 지표 업데이트
   */
  private updateIndicators(
    fromIndex: number,
    toIndex: number,
    candles: Candle[],
  ): void {
    for (let i = fromIndex; i <= toIndex; i++) {
      const candle = candles[i];
      this.rsi.update(candle.close, false);
      this.bb.update(candle.close, false);
      this.atr.update(
        {
          high: candle.high,
          low: candle.low,
          close: candle.close,
        },
        false,
      );
    }
  }

  async shouldEnter(candles: Candle[]): Promise<boolean> {
    if (
      candles.length <
      Math.max(this.config.rsiPeriod, this.config.bbPeriod) + 5
    ) {
      if (this.verbose) {
        console.log("RsiBollinger: 충분한 데이터가 없음");
      }
      return false;
    }

    // 지표 업데이트
    this.updateIndicatorsOptimized(candles, (fromIndex, toIndex) => {
      this.updateIndicators(fromIndex, toIndex, candles);
    });

    const currentPrice = candles.at(-1).close;
    const rsiValue = Number(this.rsi.getResult() || 0);
    const bbResult = this.bb.getResult();

    // 1. RSI 과매도 조건 (매우 완화)
    if (rsiValue > this.config.rsiOversold) {
      if (this.verbose) {
        console.log(
          `RsiBollinger: RSI(${rsiValue}) > ${this.config.rsiOversold}`,
        );
      }
      return false;
    }

    // 2. 볼린저밴드 조건을 매우 완화 (하단밴드의 120% 이내)
    if (!bbResult) {
      if (this.verbose) {
        console.log("RsiBollinger: 볼린저밴드 데이터 부족");
      }
      return false;
    }

    const lowerBand = Number(bbResult.lower);
    const upperBand = Number(bbResult.upper);
    const middle = Number(bbResult.middle);

    // 현재 가격이 중간선 아래에 있으면 OK (매우 완화)
    if (currentPrice > middle) {
      if (this.verbose) {
        console.log(
          `RsiBollinger: 가격(${currentPrice})이 중간선(${middle}) 위에 있음`,
        );
      }
      return false;
    }

    if (this.verbose) {
      console.log(
        `RsiBollinger: 진입 조건 만족 - RSI: ${rsiValue}, 가격: ${currentPrice}, 하단밴드: ${lowerBand}`,
      );
    }

    return true;
  }

  async execute(
    market: string,
    volume: number,
    candles: Candle[],
  ): Promise<void> {
    const entryPrice = candles.at(-1).close;

    // ATR 기반 목표가/손절가 계산
    const atrValue = this.atr.getResult();
    const { targetPrice, stopLossPrice } = this.calculateTargetLevels(
      candles,
      atrValue,
      this.config.atrMultiplierProfit,
      this.config.atrMultiplierStop,
    );

    // 주문 실행
    await this.executeOrders(market, volume, {
      entryPrice,
      targetPrice,
      stopLossPrice,
      volumeRatio: 1.0,
    });

    if (this.verbose) {
      console.log(
        `RsiBollinger: ${market} 진입 - 가격: ${entryPrice}, 목표: ${targetPrice}, 손절: ${stopLossPrice}`,
      );
    }
  }

  async shouldExit(candles: Candle[], entryPrice: number): Promise<boolean> {
    const currentPrice = candles.at(-1).close;

    // ATR 기반 동적 목표가/손절가
    const atrValue = this.atr.getResult();
    const { targetPrice, stopLossPrice } = this.calculateTargetLevels(
      candles,
      atrValue,
      this.config.atrMultiplierProfit,
      this.config.atrMultiplierStop,
    );

    // RSI 기반 추가 종료 조건 (RSI가 70 이상으로 과매수 영역 진입시)
    const rsiValue = Number(this.rsi.getResult() || 0);
    if (rsiValue > 70) {
      if (this.verbose) {
        console.log(
          `RsiBollinger: RSI 과매수 영역 도달로 종료 - RSI: ${rsiValue}`,
        );
      }
      return true;
    }

    return currentPrice >= targetPrice || currentPrice <= stopLossPrice;
  }
}
