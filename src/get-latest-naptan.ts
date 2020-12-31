import { promisify } from "util";
import { Transform, TransformCallback } from "stream";
import parse = require("csv-parse");
import stringify = require("csv-stringify");
import https = require("https");
import * as fs from "fs";
import unzipper = require("unzipper");
import {Entry} from "unzipper";

const exec = promisify(require("child_process").exec);
const URL = "https://naptan.app.dft.gov.uk/DataRequest/Naptan.ashx?format=csv";

async function main() {

    const transform = new Transform({
        objectMode: true,
        transform: (chunk: any, encoding: string, callback: TransformCallback) => {
            callback(null, [chunk[0], chunk[1], chunk[4], chunk[10], chunk[14], chunk[18], chunk[19], chunk[29], chunk[30]]);
        }
    });

    https.get(URL, (resp) => {
        resp.pipe(unzipper.Parse())
            .on("entry", (entry: Entry) => {
               if (entry.path === "Stops.csv") {
                   entry.pipe(parse()).on("error", e => console.error(e))
                       .pipe(transform).on("error", e => console.error(e))
                       .pipe(stringify()).on("error", e => console.error(e))
                       .pipe(fs.createWriteStream("resource/Stops.csv")).on("error", e => console.error(e))
                       .on("finish", () => {
                           exec("zip -jm resource/Stops.zip resource/Stops.csv", { maxBuffer: Number.MAX_SAFE_INTEGER });
                       });
               } else {
                   entry.autodrain();
               }
            });
    });

}

main().catch(e => console.log(e));