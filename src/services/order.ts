import { config } from "@/config";
import { encodeQuery, genToken, hashQuery } from "@/utils";
import { v4 } from "uuid";

export default class OrderService {
  public async test() {
    return "Order service is working";
  }
  public async getChance() {
    const query = encodeQuery({
      market: "KRW-BTC",
    });
    const queryHash = hashQuery(query);

    const payload = {
      access_key: config.accessKey,
      nonce: v4(),
      query_hash: queryHash,
      query_hash_alg: "SHA512",
    };
    const token = genToken(payload);

    const result = await fetch(
      config.serverUrl + "/v1/orders/chance?" + query,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    const data = await result.json();

    if (!result.ok) {
      console.error("Failed to fetch order chance");
      return data.error;
    }
    console.log("Order chance data:", data);

    if (!data) {
      console.error("No order chance data found");
      throw new Error("No order chance data found");
    }

    console.log("result data:", data);

    return data;
  }
}
