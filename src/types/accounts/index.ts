type AccountResponse = {
  currency: string;
  balance: number; // 주문 가능 금액/수량
  locked: number; // 주문 중 묶여있는 금액/수량
  avg_buy_price: number; // 매수 평균가
  avg_buy_price_modified: boolean; // 매수 평군가 수정 여부
  unit_currency: string; // 평단가 기준 화폐
};

export type { AccountResponse };
