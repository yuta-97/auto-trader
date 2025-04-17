import express from "express";
import expressLoader from "./loader/expressLoader";

const main = async () => {
  const app = express();
  expressLoader({ app });

  app.listen(9702, () => {
    console.log("server is running on port 9702");
  });
};

main();
