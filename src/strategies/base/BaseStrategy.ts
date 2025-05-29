/**
 * 전략 기반 클래스
 * 공통 성능 최적화 및 유틸리티 제공
 */
import { Strategy, Candle } from "../type";
import { UpbitClient } from "@/api/upbitClient";
import { Big } from "big.js";

export interface PositionSizing {
  entryPrice: number;
  targetPrice: number;
  stopLossPrice: number;
  volumeRatio: number;
}

export interface PerformanceOptimization {
  lastProcessedIndex: number;
  updateIndicators: (
    candles: Candle[],
    fromIndex: number,
    toIndex: number,
  ) => void;
  getIndicatorResults: () => Record<string, any>;
}

export abstract class BaseStrategy implements Strategy {
  abstract name: string;
  protected client: UpbitClient;
  protected lastProcessedIndex: number = -1;
  protected verbose: boolean = false;

  constructor(client: UpbitClient) {
    this.client = client;
  }

  /**
   * 성능 최적화: 증분 지표 업데이트
   */
  protected updateIndicatorsOptimized(
    candles: Candle[],
    updateCallback: (fromIndex: number, toIndex: number) => void,
  ): void {
    const currentIndex = candles.length - 1;

    if (this.lastProcessedIndex < currentIndex) {
      if (this.lastProcessedIndex === -1) {
        // 처음 실행: 모든 데이터 처리
        updateCallback(0, currentIndex);
      } else {
        // 새로운 캔들만 처리
        updateCallback(this.lastProcessedIndex + 1, currentIndex);
      }
      this.lastProcessedIndex = currentIndex;
    }
  }

  /**
   * ATR 기반 목표가 및 손절가 계산
   */
  protected calculateTargetLevels(
    candles: Candle[],
    atrValue: Big | number | null,
    profitMultiplier: number,
    stopMultiplier: number,
    minRiskReward: number = 1.5,
  ): { targetPrice: number; stopLossPrice: number } {
    const entryPrice = candles.at(-1)!.close;
    const atrNumber = atrValue ? Number(atrValue) : entryPrice * 0.02;

    let targetPrice = entryPrice + profitMultiplier * atrNumber;
    const stopLossPrice = entryPrice - stopMultiplier * atrNumber;

    // 최소 손익비 검증
    const riskReward =
      (targetPrice - entryPrice) / (entryPrice - stopLossPrice);
    if (riskReward < minRiskReward) {
      targetPrice = entryPrice + minRiskReward * (entryPrice - stopLossPrice);
    }

    return { targetPrice, stopLossPrice };
  }

  /**
   * 거래량 강도에 따른 포지션 사이징
   */
  protected calculatePositionSizing(volumeStrength: number): number {
    if (volumeStrength >= 80) return 1.0;
    if (volumeStrength >= 70) return 0.8;
    if (volumeStrength >= 60) return 0.6;
    return 0.4;
  }

  /**
   * 주문 실행 (매수 + 목표가/손절가 설정)
   */
  protected async executeOrders(
    market: string,
    volume: number,
    sizing: PositionSizing,
  ): Promise<void> {
    const adjustedVolume = volume * sizing.volumeRatio;

    // 매수 주문
    await this.client.createOrder({
      market,
      side: "bid",
      volume: adjustedVolume.toString(),
      ord_type: "market",
    });

    // 목표가 매도 주문
    await this.client.createOrder({
      market,
      side: "ask",
      price: sizing.targetPrice.toFixed(0),
      volume: adjustedVolume.toString(),
      ord_type: "limit",
    });

    // 손절 매도 주문
    await this.client.createOrder({
      market,
      side: "ask",
      price: sizing.stopLossPrice.toFixed(0),
      volume: adjustedVolume.toString(),
      ord_type: "limit",
    });
  }

  /**
   * 거래 로그 출력
   */
  protected logTrade(
    market: string,
    entryPrice: number,
    targetPrice: number,
    stopLossPrice: number,
    volumeStrength: number,
    volumeRatio: number,
  ): void {
    const profitPercent = ((targetPrice / entryPrice - 1) * 100).toFixed(2);
    const lossPercent = ((stopLossPrice / entryPrice - 1) * 100).toFixed(2);

    console.log(
      `${market} ${this.name} 진입 - 진입가: ${entryPrice}`,
      `목표가: ${targetPrice.toFixed(0)}, 손절가: ${stopLossPrice.toFixed(0)}`,
      `(이익: ${profitPercent}%, 손실: ${lossPercent}%)`,
      `- 거래량 강도: ${volumeStrength.toFixed(0)}%, 매수비율: ${(
        volumeRatio * 100
      ).toFixed(0)}%`,
    );
  }

  /**
   * 기본 종료 조건 (각 전략에서 오버라이드 가능)
   * 간단한 스톱로스/목표가 로직
   */
  async shouldExit(candles: Candle[], entryPrice: number): Promise<boolean> {
    const currentPrice = candles.at(-1)!.close;

    // 기본 3% 손절, 6% 익절
    const stopLoss = entryPrice * 0.97;
    const takeProfit = entryPrice * 1.06;

    return currentPrice <= stopLoss || currentPrice >= takeProfit;
  }

  // 추상 메서드들
  abstract shouldEnter(candles: Candle[]): Promise<boolean>;
  abstract execute(
    market: string,
    volume: number,
    candles: Candle[],
  ): Promise<void>;
}
