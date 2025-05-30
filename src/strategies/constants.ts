/**
 * 전략 관련 상수 정의
 */

// 트레이딩 대상 마켓
export const MARKETS = {
  BTC: "KRW-BTC",
  ETH: "KRW-ETH",
  SOL: "KRW-SOL",
  XRP: "KRW-XRP",
  USDT: "KRW-USDT",
};

// 거래량 설정 (BTC 기준)
export const TRADE_VOLUME = {
  BTC: 0.0005, // 기본 BTC 거래량
  ETH: 0.01, // ETH 거래량
  SOL: 0.1, // SOL 거래량
  XRP: 50, // XRP 거래량
};

// 캔들 간격 (분)
export const CANDLE_INTERVAL = {
  MIN_1: 1, // 1분봉
  MIN_3: 3, // 3분봉
  MIN_5: 5, // 5분봉
  MIN_15: 15, // 15분봉
  MIN_30: 30, // 30분봉
  MIN_60: 60, // 1시간봉
  MIN_240: 240, // 4시간봉
};
