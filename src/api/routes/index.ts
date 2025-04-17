import { Api } from "@/types";
import { Router } from "express";

const routes = (app: Router) => {
  app.get("/version.json", (req: Api.req, res: Api.res, next: Api.next) => {
    res.json({
      version: versionJson.version,
      date: versionJson.date,
      hash: versionJson.hash
    });
  });
};

export default routes;
