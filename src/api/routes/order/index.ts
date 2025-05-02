import OrderService from "@/services/order";
import { Api } from "@/types";
import { Router } from "express";

const route = Router();

export default function (app: Api.router) {
  app.use("/order", route);

  const orderService = new OrderService();

  route.get("/", async (req: Api.req, res: Api.res, next: Api.next) => {
    const response = await orderService.test();
    res.status(200).json({
      message: response,
    });
  });
}
