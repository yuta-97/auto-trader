import express, { Application, NextFunction, Request, Response } from "express";
import cors from "cors";
import api from "@/api";

const expressLoader = ({ app }: { app: Application }) => {
  app.set("trust proxy", true);
  app.use(cors({ origin: "*", credentials: true }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  app.use(api());

  // catch 404 and forward to error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.log("page not found", req);
    next();
  });

  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    res.status(500);
    res.json({
      errors: {
        message: err ? err.message : "Unexpected error",
        stack: err.stack ? err.stack : undefined
      }
    });
    next();
  });
};

export default expressLoader;
