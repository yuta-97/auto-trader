const child_process = require("child_process");
const fs = require("fs");
const packageJson = require("../package.json");

const execSync = child_process.execSync;
const commit = execSync("git rev-parse HEAD");
const date = execSync("git log -1 --pretty=format:'%ci'");

const { version } = packageJson;

const jsonData = {
  version,
  date: `${date}`.replace(/\n/g, ""),
  hash: `${commit}`.replace(/\n/g, ""),
};

const jsonContent = JSON.stringify(jsonData);

fs.writeFile("./src/version.json", jsonContent, "utf8", function (err) {
  if (err) {
    console.log("An error occured while writing JSON Object to version.json");
    return console.log(err);
  }

  console.log("version.json file has been saved with latest version number");
});
