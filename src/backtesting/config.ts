import { CANDLE_INTERVAL, MARKETS } from "../strategies/constants";

// ===== 백테스트 설정 (직접 수정해서 사용) =====
const BACKTEST_CONFIG = {
  // 테스트할 마켓 (MARKETS.BTC, MARKETS.ETH 등)
  MARKET: MARKETS.ETH,

  // 캔들 간격 (CANDLE_INTERVAL.MIN_3, MIN_5, MIN_15, MIN_30 등)
  INTERVAL: CANDLE_INTERVAL.MIN_3,

  // 초기 자본 (원)
  INITIAL_CAPITAL: 1000000, // 100만원

  // 백테스트 기간 (일)
  DAYS: 10,
};

// ===== 전략 설정 =====
const STRATEGY_CONFIG = {
  RSI_BOLLINGER: {
    rsiOversold: 45, // RSI 과매도 기준
    bbStdDev: 2.0, // 볼린저 밴드 표준편차
    profitFactorMin: 1.01, // 최소 수익률
    atrMultiplierProfit: 1.0, // ATR 기반 수익실현 배수
    atrMultiplierStop: 0.5, // ATR 기반 손절 배수
    useVolumeFilter: false, // 거래량 필터 사용 여부
  },

  TREND_BREAKOUT: {
    kFactor: 0.3,
    windowHours: 1, // 변동폭 계산 시간 (시간)
    profitTarget: 2.0,
    stopLoss: 1.5,
  },

  GRID_TRADING: {
    gridCount: 7,
    volatilityThreshold: 0.12,
    volumeEfficiencyThreshold: 0.7,
  },

  MOMENTUM_BREAK: {
    shortEmaPeriod: 3,
    longEmaPeriod: 10,
    minPriceChange: 0.05,
    profitFactor: 1.5,
    stopFactor: 1.0,
  },

  MEAN_REVERSION: {
    emaPeriod: 20,
    deviationThreshold: 1.0,
    rsiPeriod: 14,
    rsiOversold: 50,
    profitFactor: 1.5,
    stopFactor: 2.0,
  },

  VOLUME_SPIKE: {
    volumeEmaPeriod: 20,
    volumeSpikeMultiplier: 2.0,
    priceEmaPeriod: 10,
    minPriceGain: 1.0,
    profitFactor: 2.5,
    stopFactor: 1.5,
  },
};

export { BACKTEST_CONFIG, STRATEGY_CONFIG };
