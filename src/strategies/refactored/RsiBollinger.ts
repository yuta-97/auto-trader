/**
 * RSI + 볼린저 밴드 역추세 전략 (리팩토링 버전)
 * 깔끔한 구조와 모듈화된 컴포넌트 사용
 */
import { RSI, BollingerBands, ATR } from "trading-signals";
import { Candle } from "../type";
import { UpbitClient } from "@/api/upbitClient";
import { BaseStrategy } from "../base/BaseStrategy";
import {
  VolumeAnalyzer,
  VolumeAnalysisConfig,
} from "../indicators/VolumeAnalyzer";
import { TechnicalIndicators } from "../indicators/TechnicalIndicators";

export interface RsiBollingerConfig {
  rsiPeriod: number;
  rsiOversold: number;
  bbPeriod: number;
  bbStdDev: number;
  profitFactorMin: number;
  atrMultiplierProfit: number;
  atrMultiplierStop: number;
  volumeConfig: VolumeAnalysisConfig;
  minVolumeSignals: number; // 최소 거래량 신호 개수
}

export class RsiBollinger extends BaseStrategy {
  name = "RSI·볼린저 역추세 (개선)";

  private config: RsiBollingerConfig;
  private volumeAnalyzer: VolumeAnalyzer;

  // 지표 인스턴스
  private rsi: RSI;
  private bb: BollingerBands;
  private atr: ATR;

  constructor(client: UpbitClient, config?: Partial<RsiBollingerConfig>) {
    super(client);

    // 기본 설정
    this.config = {
      rsiPeriod: 14,
      rsiOversold: 30,
      bbPeriod: 20,
      bbStdDev: 2,
      profitFactorMin: 1.5,
      atrMultiplierProfit: 2,
      atrMultiplierStop: 1,
      minVolumeSignals: 2,
      volumeConfig: {
        volumeThreshold: 1.5,
        volumeRatio: 1.5,
        adlConfirmation: true,
        obvConfirmation: false,
      },
      ...config,
    };

    this.volumeAnalyzer = new VolumeAnalyzer(this.config.volumeConfig);

    // 지표 초기화
    this.rsi = new RSI(this.config.rsiPeriod);
    this.bb = new BollingerBands(this.config.bbPeriod, this.config.bbStdDev);
    this.atr = new ATR(14);
  }

  /**
   * 지표 업데이트 (성능 최적화 적용)
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

  /**
   * 기본 RSI + 볼린저 밴드 조건 확인
   */
  private checkBasicConditions(candles: Candle[]): boolean {
    const rsiValue = this.rsi.getResult();
    const bbResult = this.bb.getResult();

    if (!rsiValue || !bbResult) return false;

    const currentRSI = Number(rsiValue);
    const bbLower = Number(bbResult.lower);
    const currentPrice = candles.at(-1)!.close;

    return currentRSI <= this.config.rsiOversold && currentPrice < bbLower;
  }

  /**
   * 볼린저 밴드 중앙선을 고려한 목표가 조정
   */
  private adjustTargetWithBB(targetPrice: number): number {
    const bbResult = this.bb.getResult();
    if (bbResult) {
      const bbTarget = Number(bbResult.middle);
      return Math.min(targetPrice, bbTarget);
    }
    return targetPrice;
  }

  async shouldEnter(candles: Candle[]): Promise<boolean> {
    if (
      candles.length <
      Math.max(this.config.rsiPeriod, this.config.bbPeriod) + 10
    ) {
      return false;
    }

    // 성능 최적화: 증분 지표 업데이트
    this.updateIndicatorsOptimized(candles, (fromIndex, toIndex) => {
      this.updateIndicators(fromIndex, toIndex, candles);
    });

    // 1. 기본 조건: RSI 과매도 + 볼린저 밴드 하단 돌파
    if (!this.checkBasicConditions(candles)) {
      return false;
    }

    // 2. 거래량 분석
    const volumeAnalysis = this.volumeAnalyzer.analyzeVolumeSignals(candles);

    // 최소 거래량 신호 개수 만족 확인
    return volumeAnalysis.signalCount >= this.config.minVolumeSignals;
  }

  async execute(
    market: string,
    volume: number,
    candles: Candle[],
  ): Promise<void> {
    const entryPrice = candles.at(-1)!.close;

    // ATR 기반 목표가/손절가 계산
    const atrValue = this.atr.getResult();
    let { targetPrice, stopLossPrice } = this.calculateTargetLevels(
      candles,
      atrValue,
      this.config.atrMultiplierProfit,
      this.config.atrMultiplierStop,
      this.config.profitFactorMin,
    );

    // 볼린저 밴드 중앙선을 고려한 목표가 조정
    targetPrice = this.adjustTargetWithBB(targetPrice);

    // 거래량 강도에 따른 포지션 사이징
    const volumeStrength =
      TechnicalIndicators.calculateBuyingSellingSPressure(candles);
    const volumeRatio = this.calculatePositionSizing(volumeStrength);

    // 주문 실행
    await this.executeOrders(market, volume, {
      entryPrice,
      targetPrice,
      stopLossPrice,
      volumeRatio,
    });

    // 로그 출력
    this.logTrade(
      market,
      entryPrice,
      targetPrice,
      stopLossPrice,
      volumeStrength,
      volumeRatio,
    );
  }
}
