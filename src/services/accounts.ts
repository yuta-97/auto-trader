import { config } from "@/config";
import { AccountResponse } from "@/types";
import { genToken } from "@/utils";
import { v4 } from "uuid";

export default class AccountService {
  public async getAllAccounts(): Promise<AccountResponse> {
    const payload = {
      access_key: config.accessKey,
      nonce: v4(),
    };
    const token = genToken(payload);

    console.log("Generated token:", token);

    const result = await fetch(config.serverUrl + "/v1/accounts", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await result.json();

    if (!result.ok) {
      console.error("Failed to fetch accounts");
      return data.error;
    }
    console.log("Account data:", data);

    if (!data || data.length === 0) {
      console.error("No accounts found");
      throw new Error("No accounts found");
    }

    return {
      currency: "KRW",
      balance: 1000000,
      locked: 0,
      avg_buy_price: 0,
      avg_buy_price_modified: false,
      unit_currency: "KRW",
    };
  }
}
