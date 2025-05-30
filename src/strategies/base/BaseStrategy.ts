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
  protected isBacktest: boolean = false;

  constructor(client: UpbitClient, isBacktest: boolean = false) {
    this.client = client;
    this.isBacktest = isBacktest;
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
    const lastCandle = candles.at(-1);
    if (!lastCandle) {
      throw new Error("캔들 데이터가 비어있습니다");
    }

    const entryPrice = lastCandle.close;
    const DEFAULT_ATR_RATIO = 0.02; // 기본 ATR 비율 (2%)
    const atrNumber = atrValue
      ? Number(atrValue)
      : entryPrice * DEFAULT_ATR_RATIO;

    // ATR 값 유효성 검증
    if (atrNumber <= 0) {
      throw new Error(`유효하지 않은 ATR 값: ${atrNumber}`);
    }

    let targetPrice = entryPrice + profitMultiplier * atrNumber;
    const stopLossPrice = entryPrice - stopMultiplier * atrNumber;

    // 손절가가 진입가보다 높으면 안됨
    if (stopLossPrice >= entryPrice) {
      throw new Error(
        `손절가(${stopLossPrice})가 진입가(${entryPrice})보다 높습니다`,
      );
    }

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
    // 입력값 유효성 검증
    if (volumeStrength < 0 || volumeStrength > 100) {
      throw new Error(
        `유효하지 않은 거래량 강도: ${volumeStrength} (0-100 범위여야 함)`,
      );
    }

    // 거래량 강도에 따른 포지션 비율 결정
    if (volumeStrength >= 80) return 1.0; // 매우 강함
    if (volumeStrength >= 70) return 0.8; // 강함
    if (volumeStrength >= 60) return 0.6; // 보통
    if (volumeStrength >= 50) return 0.4; // 약함
    return 0.2; // 매우 약함 (최소 포지션)
  }

  /**
   * 주문 실행 (매수 + 목표가/손절가 설정)
   */
  protected async executeOrders(
    market: string,
    volume: number,
    sizing: PositionSizing,
  ): Promise<void> {
    // 입력값 유효성 검증
    if (!market || volume <= 0) {
      throw new Error(
        `유효하지 않은 주문 파라미터: market(${market}), volume(${volume})`,
      );
    }

    if (sizing.volumeRatio <= 0 || sizing.volumeRatio > 1) {
      throw new Error(
        `유효하지 않은 볼륨 비율: ${sizing.volumeRatio} (0-1 범위여야 함)`,
      );
    }

    if (
      sizing.targetPrice <= sizing.entryPrice ||
      sizing.stopLossPrice >= sizing.entryPrice
    ) {
      throw new Error(
        `유효하지 않은 가격 설정: 진입(${sizing.entryPrice}), 목표(${sizing.targetPrice}), 손절(${sizing.stopLossPrice})`,
      );
    }

    // 백테스트 모드에서는 실제 주문 실행하지 않음
    if (this.isBacktest) {
      if (this.verbose) {
        console.log(
          `[${this.name}] 백테스트 모드: 주문 시뮬레이션 - ${market}, 볼륨: ${
            volume * sizing.volumeRatio
          }`,
        );
      }
      return;
    }

    const adjustedVolume = volume * sizing.volumeRatio;

    try {
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
    } catch (error) {
      console.error(`[${this.name}] 주문 실행 실패:`, error);
      throw error;
    }
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
    const lastCandle = candles.at(-1);
    if (!lastCandle) {
      throw new Error("캔들 데이터가 비어있습니다");
    }

    const currentPrice = lastCandle.close;

    // 유효성 검증
    if (entryPrice <= 0 || currentPrice <= 0) {
      throw new Error(
        `유효하지 않은 가격: 진입가(${entryPrice}), 현재가(${currentPrice})`,
      );
    }

    // 기본 3% 손절, 6% 익절
    const STOP_LOSS_RATIO = 0.03; // 3%
    const TAKE_PROFIT_RATIO = 0.06; // 6%

    const stopLoss = entryPrice * (1 - STOP_LOSS_RATIO);
    const takeProfit = entryPrice * (1 + TAKE_PROFIT_RATIO);

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
