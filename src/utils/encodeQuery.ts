import { encode, ParsedUrlQueryInput } from "querystring";

const encodeQuery = (body: ParsedUrlQueryInput): string => {
  return encode(body);
};

export { encodeQuery };
