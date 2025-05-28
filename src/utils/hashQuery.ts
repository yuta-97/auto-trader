import crypto from "crypto";

const hashQuery = (encodedQuery: string) => {
  const hash = crypto.createHash("sha512");

  return hash.update(encodedQuery, "utf-8").digest("hex");
};

export { hashQuery };
