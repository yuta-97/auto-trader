import { CANDLE_INTERVAL, MARKETS } from "../strategies/constants";

// ===== 백테스트 설정 (직접 수정해서 사용) =====
const BACKTEST_CONFIG = {
  // 테스트할 마켓 (MARKETS.BTC, MARKETS.ETH 등)
  MARKET: MARKETS.BTC,

  // 캔들 간격 (CANDLE_INTERVAL.MIN_3, MIN_5, MIN_15, MIN_30 등)
  INTERVAL: CANDLE_INTERVAL.MIN_30,

  // 초기 자본 (원)
  INITIAL_CAPITAL: 10000000,

  // 백테스트 기간 (일)
  DAYS: 60,
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
    // Rolling Window 기반 변동성 계산
    rollingWindow: {
      shortPeriod: 6, // 단기 변동성 (6캔들 = 18분 if 3분봉)
      mediumPeriod: 20, // 중기 변동성 (20캔들 = 1시간 if 3분봉)
      longPeriod: 60, // 장기 변동성 (60캔들 = 3시간 if 3분봉)
      adaptiveWeight: true, // 시장 상황에 따른 가중치 조정
    },

    // 동적 K 팩터 (변동성에 따라 조정)
    kFactor: {
      base: 0.4, // 기본 돌파 계수
      volatilityAdjust: true, // 변동성에 따른 조정 활성화
      minK: 0.2, // 최소 K값 (고변동성 시)
      maxK: 0.8, // 최대 K값 (저변동성 시)
      smoothing: 0.3, // 변화 평활화 계수
    },

    // 다중 조건 진입 시스템
    entryConditions: {
      // 변동성 돌파
      breakoutConfirm: {
        enabled: true,
        consecutiveCandles: 2, // 연속 2캔들 돌파 확인
        volumeThreshold: 1.3, // 평균 거래량의 1.3배
      },

      // 모멘텀 확인
      momentum: {
        enabled: true,
        rsiPeriod: 14,
        rsiRange: { min: 45, max: 80 }, // RSI 45~80 범위에서만 진입
        priceAcceleration: 0.02, // 가격 가속도 최소 2%
      },

      // 시장 구조 필터
      marketStructure: {
        enabled: true,
        emaPeriod: 21, // 21 EMA 기준
        trendAlignment: true, // 추세 방향 일치 확인
        supportResistance: true, // 지지/저항 돌파 확인
      },
    },

    // 적응형 리스크 관리
    riskManagement: {
      // ATR 기반 동적 조정
      atr: {
        period: 14,
        profitMultiplier: 2.0, // ATR의 2배를 기본 목표
        stopMultiplier: 1.0, // ATR의 1배를 기본 손절
        trailingStop: true, // 트레일링 스탑 활성화
        trailingThreshold: 1.5, // 1.5 ATR 이익 후 트레일링 시작
      },

      // 시간 기반 조정
      timeDecay: {
        enabled: true,
        maxHoldPeriod: 80,
        decayRate: 0.95, // 시간당 목표가 감소율
      },

      // 포지션 사이징
      positionSize: {
        volatilityAdjusted: true, // 변동성에 따른 포지션 조정
        maxRiskPercent: 2.0, // 최대 리스크 2%
        minRiskReward: 1.5, // 최소 손익비 1.5:1
      },
    },

    // 시장 상황 인식
    marketRegime: {
      enabled: true,
      trendingThreshold: 0.6, // 추세장 판단 기준
      rangingThreshold: 0.3, // 횡보장 판단 기준
      volatilityPeriod: 120, // 변동성 측정 기간
      adaptiveStrategy: true, // 시장 상황별 전략 조정
    },

    // 연속 거래 제어
    tradingControl: {
      cooldownPeriod: 5, // 손절 후 5캔들 대기
      maxDailyTrades: 3, // 일일 최대 거래 횟수
      consecutiveLossLimit: 2, // 연속 손실 제한
      drawdownLimit: 0.05, // 최대 낙폭 5%
    },

    // 로깅 설정
    logging: {
      level: 2, // 0: 없음, 1: 기본, 2: 상세, 3: 디버그
      includeIndicators: true, // 지표값 포함
      performanceMetrics: true, // 성과 지표 포함
    },
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
