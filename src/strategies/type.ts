/** 공통 전략 인터페이스와 시세 타입 */

export interface Candle {
  /** UNIX epoch milliseconds */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface Strategy {
  /** 전략 이름(로깅용) */
  name: string;

  /** 진입 조건 판단 – 최신 캔들이 배열 맨 뒤에 오도록 전달 */
  shouldEnter(candles: Candle[]): Promise<boolean>;

  /** 종료 조건 판단 */
  shouldExit(candles: Candle[], entryPrice: number): Promise<boolean>;

  /** 포지션 실행(주문 + 후속 관리) */
  execute(market: string, volume: number, candles: Candle[]): Promise<void>;
}
