import { Api } from "@/types";
import { Router } from "express";
import versionJson from "@/version.json";
import order from "./order";
import accounts from "./accounts";

const routes = (app: Router) => {
  app.get("/version.json", (req: Api.req, res: Api.res, next: Api.next) => {
    res.json({
      version: versionJson.version,
      date: versionJson.date,
      hash: versionJson.hash,
    });
  });

  order(app);
  accounts(app);
};

export default routes;
