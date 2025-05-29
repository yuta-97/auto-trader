import { config } from "../config";
import { sign } from "jsonwebtoken";

const genToken = (payload: Object) => {
  const token = sign(payload, config.secretKey);

  return token;
};

export { genToken };
