import AccountService from "@/services/accounts";
import { Api } from "@/types";
import { Router } from "express";

const route = Router();

export default function (app: Api.router) {
  app.use("/accounts", route);

  const accountService = new AccountService();

  route.get("/", async (req: Api.req, res: Api.res, next: Api.next) => {
    const response = await accountService.getAllAccounts();
    console.log("response", response);
    if (!response) {
      res.status(500).json({
        message: "Failed to fetch accounts",
      });

      next();
    }
    res.status(200).json({
      message: response,
    });
  });
}
