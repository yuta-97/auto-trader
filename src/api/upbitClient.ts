/**
 * 업비트 REST·WebSocket 클라이언트
 */
import axios, { AxiosInstance } from "axios";
import WebSocket from "ws";
import { encodeQuery, genToken, hashQuery } from "../utils";
import { ParsedUrlQueryInput } from "querystring";
import { v4 } from "uuid";

export interface OrderParams extends ParsedUrlQueryInput {
  market: string;
  side: "bid" | "ask";
  volume?: string; // 수량 (market 주문 시 price 생략 가능)
  price?: string; // 가격 (market 매수 시 생략)
  ord_type: "limit" | "market";
}

export class UpbitClient {
  #rest: AxiosInstance;
  #access: string;

  constructor(access: string) {
    this.#access = access;
    this.#rest = axios.create({
      baseURL: "https://api.upbit.com/v1",
      headers: { "Content-Type": "application/json" },
    });
  }

  /** ---  캔들 조회  ------------------------- */
  async fetchCandles(market: string, unit = 1, count = 200, to?: number) {
    // GET /candles/minutes/{unit}  최대 200개 지원  [oai_citation:3‡업비트 개발자 센터](https://docs.upbit.com/kr/reference/%EB%B6%84minute-%EC%BA%94%EB%93%A4-1?utm_source=chatgpt.com)
    const params: Record<string, any> = { market, count };

    // to 파라미터가 있으면 해당 시간 이전의 데이터를 요청
    if (to) {
      params.to = new Date(to).toISOString();
    }

    const { data } = await this.#rest.get(`/candles/minutes/${unit}`, {
      params,
    });
    return data;
  }

  /** ---  주문  ----------------------------- */
  async createOrder(params: OrderParams) {
    // POST /orders   [oai_citation:4‡업비트 개발자 센터](https://docs.upbit.com/reference/%EC%9D%BCday-%EC%BA%94%EB%93%A4-1?utm_source=chatgpt.com)
    return this.#signedRequest("post", "/orders", params);
  }

  /** ---  개인 WebSocket(myOrder / myAsset) -- */
  privateWs(types: ("myOrder" | "myAsset")[], onMessage: (msg: any) => void) {
    const payload = {
      access_key: this.#access,
      nonce: v4(),
    };

    const token = genToken(payload);
    // private 엔드포인트 & 인증   [oai_citation:5‡업비트 개발자 센터](https://docs.upbit.com/kr/reference/websocket-myorder?utm_source=chatgpt.com) [oai_citation:6‡업비트 개발자 센터](https://docs.upbit.com/reference/websocket-myasset?utm_source=chatgpt.com)
    const ws = new WebSocket("wss://api.upbit.com/websocket/v1/private", {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    ws.on("open", () => {
      ws.send(
        JSON.stringify([
          { ticket: "auto-trader" },
          ...types.map(t => ({ type: t })),
        ]),
      );
    });
    ws.on("message", data => onMessage(JSON.parse(data[0].toString())));
    ws.on("ping", () => ws.pong()); // keep-alive

    ws.on("close", () => console.log("CLOSED!!"));
    return ws;
  }

  /** ---  서명 헬퍼  ------------------------- */
  #signedRequest<T>(
    method: "get" | "post" | "delete",
    path: string,
    body: ParsedUrlQueryInput,
  ) {
    const query = encodeQuery(body);
    const queryHash = hashQuery(query);
    const payload = {
      access_key: this.#access,
      nonce: v4(),
      query_hash: queryHash,
      query_hash_alg: "SHA512",
    };
    const token = genToken(payload);

    return this.#rest.request<T>({
      method,
      url: path,
      data: body,
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}
