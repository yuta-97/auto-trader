import { ATR } from "trading-signals";
import { Candle } from "../type";
import { UpbitClient } from "@/api/upbitClient";
import { BaseStrategy } from "../base/BaseStrategy";
import { GridAnalyzer, GridConfig } from "../indicators/GridAnalyzer";

export class GridTrading extends BaseStrategy {
  name = "그리드";

  private config: GridConfig;
  private gridAnalyzer: GridAnalyzer;

  // 지표 인스턴스
  private atr: ATR;

  constructor(
    client: UpbitClient,
    config?: Partial<GridConfig>,
    isBacktest: boolean = false,
  ) {
    super(client, isBacktest);

    // 기본 설정 (진입 조건 완화)
    this.config = {
      gridCount: 3, // 5 → 3으로 완화
      minRangePct: 0.015, // 0.02 → 0.015로 완화
      volatilityThreshold: 0.25, // 0.15 → 0.25로 완화 (더 높은 변동성 허용)
      gridStepMultiplier: 0.3, // 0.5 → 0.3으로 완화
      volumeAnalysisPeriod: 50, // 100 → 50으로 단축
      volumeTrendPeriod: 10, // 20 → 10으로 단축
      volumeEfficiencyThreshold: 0.4, // 0.6 → 0.4로 완화
      ...config,
    };

    this.gridAnalyzer = new GridAnalyzer(this.config);
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
   * 그리드 조건 확인
   */
  private checkGridConditions(candles: Candle[]): {
    isValidForGrid: boolean;
    gridLevels: any;
    atrValue: number;
  } {
    const atrResult = this.atr.getResult();
    const atrValue = atrResult ? Number(atrResult) : 0;

    // 박스권 여부 확인
    const isInSidewaysTrend = this.gridAnalyzer.isInSidewaysTrend(
      candles,
      atrValue,
    );

    // 거래량 추세 분석
    const volumeTrend = this.gridAnalyzer.analyzeVolumeTrend(candles);

    // 지지/저항 레벨 분석
    const gridLevels = this.gridAnalyzer.findSupportResistanceLevels(candles);

    const isValidForGrid =
      isInSidewaysTrend &&
      volumeTrend.volumeRatio > this.config.volumeEfficiencyThreshold &&
      gridLevels.keyLevels.length >= 3;

    return { isValidForGrid, gridLevels, atrValue };
  }

  async shouldEnter(candles: Candle[]): Promise<boolean> {
    if (candles.length < this.config.volumeAnalysisPeriod) {
      if (this.verbose) {
        console.log("GridTrading: 충분한 데이터가 없음");
      }
      return false;
    }

    // 성능 최적화: 증분 지표 업데이트
    this.updateIndicatorsOptimized(candles, (fromIndex, toIndex) => {
      this.updateIndicators(fromIndex, toIndex, candles);
    });

    // 그리드 조건 확인
    const { isValidForGrid } = this.checkGridConditions(candles);

    if (this.verbose && isValidForGrid) {
      console.log("GridTrading: 박스권 패턴 감지 - 그리드 전략 활성화");
    }

    return isValidForGrid;
  }

  async execute(
    market: string,
    volume: number,
    candles: Candle[],
  ): Promise<void> {
    const { atrValue } = this.checkGridConditions(candles);
    const currentPrice = candles.at(-1).close;

    // 그리드 간격 계산
    const gridSpacing = this.gridAnalyzer.calculateGridSpacing(
      atrValue,
      currentPrice,
    );

    // 그리드 레벨 생성
    const buyLevels: number[] = [];
    const sellLevels: number[] = [];

    for (let i = 1; i <= this.config.gridCount; i++) {
      buyLevels.push(currentPrice - gridSpacing * i);
      sellLevels.push(currentPrice + gridSpacing * i);
    }

    // 거래량을 그리드 수로 분할
    const gridVolume = volume / this.config.gridCount;

    // 백테스트 모드에서는 실제 주문 실행하지 않음
    if (this.isBacktest) {
      if (this.verbose) {
        console.log(
          `[${this.name}] 백테스트 모드: 그리드 주문 시뮬레이션 - ${market}, 그리드 수: ${this.config.gridCount}`,
        );
      }
      return;
    }

    // 매수 그리드 주문
    for (const buyLevel of buyLevels) {
      await this.client.createOrder({
        market,
        side: "bid",
        price: buyLevel.toFixed(0),
        volume: gridVolume.toString(),
        ord_type: "limit",
      });
    }

    // 매도 그리드 주문
    for (const sellLevel of sellLevels) {
      await this.client.createOrder({
        market,
        side: "ask",
        price: sellLevel.toFixed(0),
        volume: gridVolume.toString(),
        ord_type: "limit",
      });
    }

    if (this.verbose) {
      console.log(
        `${market} 그리드 전략 실행`,
        `현재가: ${currentPrice}, 간격: ${gridSpacing.toFixed(0)}`,
        `매수레벨: ${buyLevels.map(l => l.toFixed(0)).join(", ")}`,
        `매도레벨: ${sellLevels.map(l => l.toFixed(0)).join(", ")}`,
      );
    }
  }

  /**
   * 종료 조건 판단 (그리드 전략은 기본적으로 계속 실행)
   */
  async shouldExit(candles: Candle[], entryPrice: number): Promise<boolean> {
    // 그리드 전략은 대부분 계속 실행되지만, 극단적인 변동성이나 손실에서는 중단
    const currentPrice = candles.at(-1).close;

    // 20% 이상 손실이면 중단
    const lossThreshold = entryPrice * 0.8;
    if (currentPrice <= lossThreshold) {
      return true;
    }

    // 변동성이 너무 높으면 중단 (ATR 기준)
    const atrValue = this.atr.getResult();
    if (atrValue) {
      const atrPercent = Number(atrValue) / currentPrice;
      if (atrPercent > 0.1) {
        // 10% 이상 변동성
        return true;
      }
    }

    return false;
  }
}
