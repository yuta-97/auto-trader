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

  constructor(client: UpbitClient, config?: Partial<GridConfig>) {
    super(client);

    // 기본 설정
    this.config = {
      gridCount: 5,
      minRangePct: 0.02,
      volatilityThreshold: 0.15,
      gridStepMultiplier: 0.5,
      volumeAnalysisPeriod: 100,
      volumeTrendPeriod: 20,
      volumeEfficiencyThreshold: 0.6,
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
}
