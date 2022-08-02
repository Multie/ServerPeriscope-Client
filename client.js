/*
 *   Copyright (c) 2022 Malte Hering
 *   All rights reserved.

 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at

 *   http://www.apache.org/licenses/LICENSE-2.0

 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 */
/////////////////////////////////////////////////////////////////
//#region Logger
const readline = require('readline');
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
var logger_names = [];
var logger_backlog = [];
var logger_input = false;
var logger_colors = { err: "\u001b[31m", info: "\x1b[37m", warn: "\x1b[33m" }
function logger(type, name, text, force = false) {
    if (!logger_names.includes(name)) {
        logger_names.push(name);
    }
    if (!logger_input || force) {
        var color = logger_colors[type];
        if (!color) {
            color = "";
        }
        if (typeof (text) == "string") {
            console.log(`${color}[${name}]:${text}\u001b[0m`);
        }
        else if (typeof (text) == "object") {
            process.stdout.write(`${color}[${name}]:\u001b[0m`);
            console.log(text);
            //process.stdout.write("\u001b[0m");
        }
    }
    else {
        logger_backlog.push({ type: type, name: name, text: text });
    }
}
function loggerStop() {
    logger_input = true;
}
function loggerResume() {
    logger_input = false;
    while (logger_backlog.length > 0) {
        var log = logger_backlog.shift();
        logger(log.type, log.name, log.text);
    }
}
//#endregion
/////////////////////////////////////////////////////////////////
//#region EventEmitter
var EventEmitter;
try {
    EventEmitter = require("node:events")
    // do stuff
} catch (ex) {
    EventEmitter = require("events");
}
class MyEmitter extends EventEmitter { }
const incommingEvents = new MyEmitter();
const outgoingEvents = new MyEmitter();
//#endregion
/////////////////////////////////////////////////////////////////
//#region Config
const PATH = require("path");
const FS = require("fs");
const { resolve } = require("path");
function readConfig(path) {
    if (FS.existsSync(path)) {
        var filebuffer = FS.readFileSync(path);
        return JSON.parse(filebuffer);
    }
    return {};
}
var config = readConfig(`${__dirname}${PATH.sep}configs${PATH.sep}config.json`);
//#endregion
/////////////////////////////////////////////////////////////////
//#region Websocket
const ws = require("ws");
const WebSocket = ws.WebSocket;

class WebsocketClient {
    constructor(config, incommingEvents, outgoingEvents) {
        this.config = config;
        this.incommingEvents = incommingEvents;
        this.outgoingEvents = outgoingEvents;

        this.connected = false;
    }

    heartbeat() {
        clearTimeout(this.pingTimeout);

        // Use `WebSocket#terminate()`, which immediately destroys the connection,
        // instead of `WebSocket#close()`, which waits for the close timer.
        // Delay should be equal to the interval at which your server
        // sends out pings plus a conservative assumption of the latency.
        this.pingTimeout = setTimeout(() => {
            //this.terminate();
        }, 30000 + 1000);
    }

    connect() {
        return new Promise((resolve) => {

            try {


                this.websocketclient = new WebSocket(`ws://${this.config.hostname}:${this.config.port}`);

                var timeout = setTimeout(() => {
                    if (!this.connected) {
                        if ([this.websocketclient.CLOSING, this.websocketclient.OPEN].includes(this.websocketclient.readyState))
                            this.websocketclient.terminate();
                        logger("err", "WSC", "Timeout");
                        resolve();
                    }
                }, this.config.reconnectInterval * 3);

                var event = (data) => {
                    this.websocketclient.send(JSON.stringify(data));
                }
                this.websocketclient.on('open', () => {
                    logger("info", "WSC", `Connected to ws://${this.config.hostname}:${this.config.port}`);
                    this.connected = true;
                    this.outgoingEvents.on("event", event);
                    clearTimeout(timeout);
                });
                this.websocketclient.on('message', (data) => {
                    data = JSON.parse(data)
                    logger("info", "WSC", data);
                    this.incommingEvents.emit("event", data);
                });
                this.websocketclient.on('ping', this.heartbeat);
                this.websocketclient.on('close', (err) => {
                    logger("info", "WSC", `closed`);
                    this.connected = false;
                    this.outgoingEvents.removeListener("event", event);
                    clearTimeout(timeout);
                    resolve();
                });
                this.websocketclient.on('error', (err) => {
                    logger("err", "WSC", err);
                    this.connected = false;
                    this.outgoingEvents.removeListener("event", event);
                    clearTimeout(timeout);
                    resolve();
                });
            }
            catch
            { resolve(); }
        });
    }

    start() {
        this.connect();
        setInterval(() => {
            if (!this.connected) {
                this.connect().catch((err) => {

                });
            }
        }, 1000);
    }

}

var WebsocketClientInstance = new WebsocketClient();
//#endregion
/////////////////////////////////////////////////////////////////
//#region TCP Client
const net = require('net');
class tcpClient {

    constructor(config, incommingEvents, outgoingEvents) {
        this.config = config;
        this.incommingEvents = incommingEvents;
        this.outgoingEvents = outgoingEvents;
        this.connections = [];
    }
    setup() {
        this.incommingEvents.on("event", (connection) => {
            logger("info", "TCP", "incommingEvents");
            //logger("info","TCP",connection);
            if (connection.event == "connection") {
                try {
                    var client = new net.Socket();
                    client.connect(this.config.sendPort, '127.0.0.1', () => {

                        this.connections.push({ client: client, connection: connection });

                        client.on('data', (chunk) => {
                            if (chunk.length > 0) {
                                connection.data = new Array(chunk.length);
                                for (let i = 0; i < chunk.length; i = i + 1)
                                    connection.data[i] = chunk[i];
                            }
                            else {
                                connection.data = [];
                            }
                            connection.event = "message";
                            this.outgoingEvents.emit("event", connection);
                        });
                        client.on('close', () => {
                            connection.event = "closed";
                            this.outgoingEvents.emit("event", connection);
                            var index = this.connections.indexOf(connection);
                            this.connections.splice(index, 1);

                        });
                        client.on('error', (err) => {
                            connection.event = "closed";
                            this.outgoingEvents.emit("event", connection);
                            var index = this.connections.indexOf(connection);
                            this.connections.splice(index, 1);

                        });
                    });
                }
                catch
                { }
            }
            else if (connection.event == "message") {
                var element = this.connections.find((con) => {
                    return (connection.ip == con.connection.ip && connection.port == con.connection.port);
                })
                if (element) {
                    var client = element.client;
                    if (connection.data.length > 0) {
                        let buf = new Buffer.from(Uint8Array.from(connection.data));
                        client.write(buf);
                    }
                }
            }
            else if (connection.event == "closed") {
                var element = this.connections.find((con) => {
                    return connection.ip == con.connection.ip && connection.port == con.connection.port;
                })
                if (element) {
                    var client = element.client;
                    client.end();
                    client.destroy();
                }
            }
        });
    }
}
var tcpClientInstance = new tcpClient(config, incommingEvents, outgoingEvents);
tcpClientInstance.setup();
//#endregion
/////////////////////////////////////////////////////////////////
//#region Web Client
const http = require("http");
var yauzl = require("yauzl");
var yazl = require("yazl");

class WebClient {
    constructor(config) {
        this.config = config;
    }

    request(method, path, data, contenttype = null) {
        return new Promise((resolve, reject) => {
            try {


                let buff = Buffer.from(`${this.config.name}:${this.config.password}`, 'utf-8');
                const auth = buff.toString('base64');
                let options = {
                    hostname: this.config.hostname,
                    port: this.config.port,
                    path: path,
                    method: method,
                    headers: {
                        Authorization: `Basic ${auth}`
                    }
                }
                if (method != "GET") {
                    options.headers['Content-Type'] = 'contenttype';
                    options.headers['Content-Length'] = data.length;
                }
                logger("info", "WC", `Request ${method} ${path}`)
                let req = http.request(options, (res) => {
                    logger("info", "WC", `Request statusCode:${res.statusCode}`)
                    let text = "";
                    res.on('data', chunk => {
                        text += chunk;
                        logger("info", "WC", `Request data:${chunk}`)
                    });
                    res.on('close', () => {

                        logger("info", "WC", `close + ${text}`);
                        resolve(text);
                    });
                });
                req.on('error', err => {
                    logger("err", "WC", err);
                    reject(err);
                });
                if (data.length > 0) {
                    req.write(data);
                }
                req.end();
            }
            catch (err) {
                logger("err", "WC", err);
                reject(err);
            }
        });
    }

    requestFile(method, path, data, filepath) {
        return new Promise((resolve, reject) => {
            try {
                let buff = Buffer.from(`${this.config.name}:${this.config.password}`, 'utf-8');
                const auth = buff.toString('base64');
                let options = {
                    hostname: this.config.hostname,
                    port: this.config.port,
                    path: path,
                    method: method,
                    headers: {
                        Authorization: `Basic ${auth}`
                    }
                }
                console.log(options);

                logger("info", "WC", `Request ${method} ${path}`)
                let req = http.get(options, (res) => {
                    logger("info", "WC", `Request statusCode:${res.statusCode}`)

                    res.pipe(FS.createWriteStream(filepath)).on('close', () => {
                        logger("info", "WC", `close`);
                        resolve();
                    });
                });
                req.on('error', err => {
                    logger("err", "WC", err);
                    reject(err);
                });
            }
            catch (err) {
                logger("err", "WC", err);
                reject(err);
            }
        });
    }

    postFile(method, path, filepath) {
        return new Promise((resolve, reject) => {
            try {
                let buff = Buffer.from(`${this.config.name}:${this.config.password}`, 'utf-8');
                const auth = buff.toString('base64');

                var stat = FS.statSync(filepath);
                let options = {
                    hostname: this.config.hostname,
                    port: this.config.port,
                    path: path,
                    method: method,
                    headers: {
                        Authorization: `Basic ${auth}`,
                        'Content-Type': 'application/octet-stream',
                        'Content-Length': stat.size
                    }
                }
                let req = http.request(options, (res) => {
                    logger("info", "WC", `Request statusCode:${res.statusCode}`)
                    let text = "";
                    res.on('data', chunk => {
                        text += chunk;
                        logger("info", "WC", `Request data:${chunk}`)
                    });
                    res.on('close', () => {

                        logger("info", "WC", `close + ${text}`);
                        resolve(text);
                    });

                });
                req.on('error', err => {
                    logger("err", "WC", err);
                    reject(err);
                });

                var readStream = FS.createReadStream(filepath);
                readStream.pipe(req);
                readStream.on("end", () => {
                    req.end();
                })
            }
            catch (err) {
                logger("err", "WC", err);
                reject(err);
            }
        });
    }

    zipFolderAddFiles(zipfile, root, replath) {
        return new Promise((resolve, reject) => {

            FS.readdir(root + PATH.sep + replath, { withFileTypes: true }, (err, files) => {
                if (err) {
                    console.trace(err);
                    reject(err);
                    return;
                }
                //console.log(files);
                var proms = [];
                for (var a = 0; a < files.length; a++) {
                    var childpath = replath + PATH.sep + files[a].name;
                    if (files[a].isDirectory()) {
                        proms.push(this.zipFolderAddFiles(zipfile, root, childpath));
                    }
                    else if (files[a].isFile()) {
                        var filepath = root + PATH.sep + replath + PATH.sep + files[a].name;
                        var zippath = replath + PATH.sep + files[a].name;
                        zippath = zippath.slice(1);
                        zipfile.addFile(filepath, zippath);
                    }
                }
                Promise.allSettled(proms).then((results) => {
                    resolve();
                });
            });
        });
    }

    zipFolder(folder, file) {
        return new Promise(resolve => {
            var zipfile = new yazl.ZipFile();

            zipfile.outputStream.pipe(FS.createWriteStream(file)).on("close", () => {
                resolve();
            });

            this.zipFolderAddFiles(zipfile, folder, "").then(() => {
                zipfile.end();
            });
        });
    }

    unzipFolder(file, folder) {
        return new Promise((resolve, reject) => {
            yauzl.open(file, { lazyEntries: true }, function (err, zipfile) {
                if (err) {
                    console.trace(err);
                    reject(err);
                    return;
                };
                zipfile.readEntry();
                zipfile.on("entry", function (entry) {

                    if (/\/$/.test(entry.fileName)) {
                        // Directory file names end with '/'.
                        // Note that entries for directories themselves are optional.
                        // An entry's fileName implicitly requires its parent directories to exist.
                        zipfile.readEntry();
                    } else {
                        // file entry
                        var filepath = [folder, entry.fileName].join(PATH.sep);
                        FS.mkdir(PATH.dirname(filepath), { recursive: true }, (err) => {
                            if (err) {
                                console.trace(err);
                                reject(err);
                                return;
                            };
                            zipfile.openReadStream(entry, function (err, readStream) {
                                if (err) {
                                    console.trace(err);
                                    reject(err);
                                    return;
                                };
                                readStream.on("end", function () {
                                    zipfile.readEntry();
                                });
                                readStream.pipe(FS.createWriteStream([folder, entry.fileName].join(PATH.sep)));
                            });
                        })

                    }
                });
                zipfile.on("end", () => {
                    zipfile.close();
                    resolve();
                })
            });
        });
    }

    downloadLatestService() {
        return new Promise((resolve, reject) => {
            var currentServicePath = [__dirname, "data", "current"].join(PATH.sep);
            var currentServiceFilePath = [__dirname, "data", "current", "current.zip"].join(PATH.sep);
            console.log(currentServicePath);
            FS.rm(currentServicePath, { recursive: true }, (err) => {
                if (err) {
                    console.trace(err);
                    reject(err);
                    return;
                }
                FS.mkdir(currentServicePath, (err) => {
                    if (err) {
                        console.trace(err);
                        reject(err);
                        return;
                    }
                    this.requestFile("GET", "/data", "", currentServiceFilePath).then(() => {
                        this.unzipFolder(currentServiceFilePath, currentServicePath).then(() => {
                            console.log("Unzip complete");
                            resolve();
                        });
                    });
                });
            });



        });
    }
    uploadCurrentService() {
        return new Promise((resolve, reject) => {
            var folderPath = [__dirname, "data", "current"].join(PATH.sep);
            var curdate = new Date(Date.now());
            var zipPath = [__dirname, "data", "old", `${this.config.name}#${curdate.toISOString().replaceAll(":", "_").replaceAll(".", ",")}.zip`].join(PATH.sep);

            logger("info", "uploadCurrentService", folderPath);
            logger("info", "uploadCurrentService", zipPath);
            logger("info", "uploadCurrentService", "Start creating zip file");
            this.zipFolder(folderPath, zipPath).then(() => {
                logger("info", "uploadCurrentService", "Done creating zip file");
                logger("info", "uploadCurrentService", "Start upload");
                this.postFile("POST", "/data", zipPath).then(() => {
                    logger("info", "uploadCurrentService", "Done upload");
                    resolve();
                }, (err) => {
                    reject(err);
                });
            }, (err) => {
                reject(err);
            })
        });
    }

    becomeHost() {
        return new Promise((resolve, reject) => {
            this.request("GET", "/host", "").then(() => {
                resolve();
            }, (err) => {
                reject(err);
            });
        });
    }
}
var WebClientInstance = new WebClient(config);
//#endregion
/////////////////////////////////////////////////////////////////
//#region Run Service
const { exec } = require('child_process');
class RunService {
    constructor(config) {
        this.config = config;
    }

    runService() {
        return new Promise((resolve, reject) => {
            var datapath = [__dirname, "data", "current"].join(PATH.sep);
            //`title MinecraftServer & start cmd.exe /c "${this.config.startcommand} & pause"`
            var child = exec(`${this.config.startcommand}`, { cwd: datapath })
            //var child = exec("echo", ["hallow", "welt"])

            readline.emitKeypressEvents(process.stdin);
            process.stdin.setRawMode(true);
            child.stdout.pipe(process.stdout);
            process.stdin.pipe(child.stdin);

            child.on("close", () => {
                console.log("close");
                resolve();
            });
        });
    }

}
var RunServiceInstance = new RunService(config);
//#endregion
/////////////////////////////////////////////////////////////////
//#region Input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askCurrentService() {
    return new Promise(resolve => {
        rl.question("Do you want to download the latest version ? [y/n]", (answer) => {
            if (answer == "y") {
                WebClientInstance.downloadLatestService().then(() => {
                    resolve();
                }, (err) => {
                    resolve();
                });
            }
            else {
                resolve();
            }
        });
    })

}
function askStartService() {
    return new Promise(resolve => {
        rl.question("Would you like to start the service ? [y/n]", (answer) => {
            if (answer == "y") {
                RunServiceInstance.runService().then(() => {
                    resolve();
                }, (err) => {
                    resolve();
                });
            }
            else {
                resolve();
            }
        });
    });
}
function askBecomeHost() {
    return new Promise(resolve => {
        rl.question("Would you like to be the host? [y/n]", (answer) => {
            if (answer == "y") {
                WebClientInstance.becomeHost().then(() => {
                    WebsocketClientInstance.start();
                    resolve();
                }, (err) => {
                    resolve();
                });
            }
            else {
                resolve();
            }
        });
    });
}
function askUploadService() {
    return new Promise(resolve => {
        rl.question("Do you want to upload the current version? [y/n]", (answer) => {
            if (answer == "y") {
                WebClientInstance.uploadCurrentService().then(() => {
                    logger("info", "uploadCurrentService", `done`);
                    resolve();
                }, (err) => {
                    resolve();
                });
            }
            else {
                resolve();
            }
        });
    });
}

askCurrentService().then(() => {
    askBecomeHost().then(() => {
        askStartService().then(() => {
            askUploadService().then(() => {
                process.exit()
            })
        })
    })
})

//#endregion
