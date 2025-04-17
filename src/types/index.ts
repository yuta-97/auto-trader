import { Application, NextFunction, Router } from "express";

declare namespace Api {
  export type req = Request;
  export type res = Response;
  export type next = NextFunction;
  export type router = Router;
  export type application = Application;
}

export type { Api };
