import fs from "fs";
import path from "path";
import { Candle } from "../strategies/type";
import { UpbitClient } from "../api/upbitClient";

export class BacktestDataProvider {
  private dataPath: string;

  constructor(dataDir = path.join(__dirname, "../../data")) {
    this.dataPath = dataDir;

    // 데이터 디렉토리 생성
    if (!fs.existsSync(this.dataPath)) {
      fs.mkdirSync(this.dataPath, { recursive: true });
    }
  }

  /**
   * 특정 마켓의 캔들 데이터 CSV 파일 경로 생성
   */
  private getCandleFilePath(market: string, interval: number): string {
    return path.join(
      this.dataPath,
      `${market.replace("-", "_")}_${interval}min.csv`,
    );
  }

  /**
   * 캔들 데이터를 CSV로 저장
   */
  saveCandles(market: string, interval: number, candles: Candle[]): void {
    const filePath = this.getCandleFilePath(market, interval);

    const headers = "timestamp,open,high,low,close,volume\n";
    const rows = candles
      .map(
        candle =>
          `${candle.timestamp},${candle.open},${candle.high},${candle.low},${
            candle.close
          },${candle.volume || 0}`,
      )
      .join("\n");

    fs.writeFileSync(filePath, headers + rows, "utf8");
    console.log(`저장 완료: ${filePath} (${candles.length}개 캔들)`);
  }

  /**
   * CSV에서 캔들 데이터 로드
   */
  loadCandles(market: string, interval: number): Candle[] {
    const filePath = this.getCandleFilePath(market, interval);

    if (!fs.existsSync(filePath)) {
      throw new Error(
        `${filePath} 파일이 존재하지 않습니다. 먼저 데이터를 수집해주세요.`,
      );
    }

    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.trim().split("\n");

    // 헤더 제외
    const dataLines = lines.slice(1);

    return dataLines.map(line => {
      const [timestamp, open, high, low, close, volume] = line.split(",");
      return {
        timestamp: parseInt(timestamp),
        open: parseFloat(open),
        high: parseFloat(high),
        low: parseFloat(low),
        close: parseFloat(close),
        volume: parseFloat(volume),
      };
    });
  }

  /**
   * 업비트에서 히스토리컬 데이터 수집
   * (최대 API 제한을 고려하여 일정 간격으로 요청)
   */
  async collectHistoricalData(
    client: UpbitClient,
    market: string,
    interval: number,
    days: number = 30,
  ): Promise<Candle[]> {
    const candlesPerDay = (24 * 60) / interval;
    const totalCandles = days * candlesPerDay;
    let allCandles: Candle[] = [];

    // 업비트 API 제한으로 한번에 최대 200개까지만 요청 가능
    const batchSize = 200;
    const batchCount = Math.ceil(totalCandles / batchSize);

    console.log(
      `${market} ${interval}분봉 데이터 수집 시작 (${days}일, 총 ${totalCandles}개)`,
    );

    // 오래된 데이터에서부터 최신 데이터 순으로 수집
    let to = new Date().getTime();

    for (let i = 0; i < batchCount; i++) {
      const count = Math.min(batchSize, totalCandles - i * batchSize);

      try {
        // to 파라미터를 사용하여 특정 시간 이전의 데이터를 요청
        const toDate = new Date(to);
        const toDateString = toDate.toISOString();

        console.log(
          `배치 ${
            i + 1
          }/${batchCount} 요청 중 (${toDateString}까지의 ${count}개)...`,
        );

        const data = await client.fetchCandles(market, interval, count, to);

        if (!data || data.length === 0) {
          console.log("더 이상 데이터가 없습니다.");
          break;
        }

        // 응답 데이터를 Candle 형식으로 변환
        const candles: Candle[] = data.map((item: any) => ({
          timestamp: new Date(item.candle_date_time_utc).getTime(),
          open: parseFloat(item.opening_price),
          high: parseFloat(item.high_price),
          low: parseFloat(item.low_price),
          close: parseFloat(item.trade_price),
          volume: parseFloat(item.candle_acc_trade_volume),
        }));

        allCandles = [...candles, ...allCandles]; // 시간 순서대로 정렬

        // 마지막 캔들의 시간을 다음 요청의 기준점으로 설정
        to = new Date(data[data.length - 1].candle_date_time_utc).getTime();

        // API 호출 제한을 고려한 딜레이 (초당 요청 수 제한)
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        console.error("데이터 수집 중 오류 발생:", error);
        break;
      }
    }

    console.log(`데이터 수집 완료: ${allCandles.length}개 캔들`);

    // 시간 순으로 정렬 (오래된 -> 최신)
    allCandles.sort((a, b) => a.timestamp - b.timestamp);

    // CSV 파일로 저장
    this.saveCandles(market, interval, allCandles);

    return allCandles;
  }
}
