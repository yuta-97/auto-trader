import { Router } from "express";
import routes from "./routes";

const api = () => {
  const app = Router();
  routes(app);
  return app;
};

export default api;
