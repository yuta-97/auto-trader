/**
 * PRE-requisite function.
 *
 * check env files and set module import method.
 */

import { configDotenv } from "dotenv";
import moduleAlias from "module-alias";
moduleAlias.addAlias("@", __dirname);
configDotenv();

import { config } from "@/config";
import express from "express";
import { expressLoader } from "./loader";

const main = async () => {
  const app = express();
  expressLoader({ app });

  app.listen(config.portNumber, () => {
    console.log(`server is running on port ${config.portNumber}`);
  });
};

main();
