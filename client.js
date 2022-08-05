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
var logger_colors = { err: "\u001b[31m", info: "\033[38;5;159m", warn: "\x1b[33m", reset: "\u001b[0m" }
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
loggerResume();

var logTimesData = {};
function timeTimes(name,date) {
    if (logTimesData[name] == undefined || logTimesData[name] == null) {
        logTimesData[name] = 0;
    }
    logTimesData[name] = ((9/10) * logTimesData[name]) + ((1/10) * (Date.now() - date));
}
function logTimes() {
    var keys = Object.keys(logTimesData);
    let text = "";
    for (var a = 0; a < keys.length;a++) {
        text += ` ${keys[a]}: ${ Math.round(logTimesData[keys[a]]*1000)/1000} ms`;
    }
    logger("info","time",text);
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
const net = require('net');
class WebsocketClient {
    constructor(config) {
        this.config = config;


        this.connected = false;
        this.reconectInterval = null;

        this.connections = {};
        setInterval(()=> {
            logTimes();
        },5000);

    }

    heartbeat() {
        clearTimeout(this.pingTimeout);

        // Use `WebSocket#terminate()`, which immediately destroys the connection,
        // instead of `WebSocket#close()`, which waits for the close timer.
        // Delay should be equal to the interval at which your server
        // sends out pings plus a conservative assumption of the latency.
        this.pingTimeout = setTimeout(() => {
            this.websocketclient.close();
            //this.terminate();
        }, 30000 + 1000);
    }

    connect() {
        return new Promise((resolve, reject) => {
            try {
                logger("info", "Websocket", `Connecting to Server:${this.config.hostname}:${this.config.port}`);
                this.websocketclient = new WebSocket(`ws://${this.config.hostname}:${this.config.port}`);

                var timeout = setTimeout(() => {
                    if (!this.connected) {
                        if ([this.websocketclient.CLOSING, this.websocketclient.OPEN].includes(this.websocketclient.readyState))
                            this.websocketclient.terminate();
                        logger("err", "Websocket", `Timeout connecting to Server:${this.config.hostname}:${this.config.port}`);
                        resolve();
                    }
                }, this.config.reconnectInterval * 3);

                this.websocketclient.on('open', () => {
                    logger("info", "Websocket", `Connected`);
                    this.connected = true;
                    //this.outgoingEvents.on("event", event);
                    clearTimeout(timeout);
                });

                this.websocketclient.on('message', (data) => {
                    data = JSON.parse(data)
                    if (!data) {
                        return;
                    }
                    timeTimes("wsRecieved",data.timestamp);
                    if (data.event == "connection") {
                        var client = new net.Socket();
                        client.connect(this.config.sendPort, '127.0.0.1', () => {
                            this.connections[data.id] = { client: client };
                            client.on('data', (chunk) => {
                                var connection = {
                                    id:data.id,
                                    event:"message",
                                    timestamp:Date.now()
                                };
                                timeTimes("tcpRecieved",connection.timestamp);
                                if (chunk.length > 0) {
                                    connection.data = new Array(chunk.length);
                                    for (let i = 0; i < chunk.length; i = i + 1)
                                        connection.data[i] = chunk[i];
                                }
                                else {
                                    connection.data = [];
                                }
                                this.websocketclient.send(JSON.stringify(connection));
                                timeTimes("wsSend",connection.timestamp);
                            });
                            client.on("close",()=> {
                                var connection = {
                                    id:data.id,
                                    event:"closed",
                                    timestamp:Date.now()
                                };
                                this.websocketclient.send(JSON.stringify(connection));
                            });
                        });
                    }
                    else if (data.event == "message") {
                        if (this.connections[data.id]) {
                            var client = this.connections[data.id].client;
                            let buf = new Buffer.from(Uint8Array.from(data.data));
                            client.write(buf);
                            timeTimes("tcpSend",data.timestamp);
                        }
                    }
                    else if (data.event == "closed") {
                        if (this.connections[data.id]) {
                            var client = this.connections[data.id].client;
                            client.destroy();
                        }
                        delete this.connections[data.id]
                    }


                });
                
                this.websocketclient.on('ping', this.heartbeat);
                this.websocketclient.on('close', (err) => {
                    logger("err", "Websocket", `Disconected`);
                    this.connected = false;
                    //this.outgoingEvents.removeListener("event", event);
                    clearTimeout(timeout);
                    resolve();
                });
                this.websocketclient.on('error', (err) => {
                    logger("err", "WSC", err);
                    logger("err", "Websocket", `Errored: ${err}`);
                    this.connected = false;
                    //this.outgoingEvents.removeListener("event", event);
                    clearTimeout(timeout);
                    resolve();
                });
            }
            catch (err) {
                logger("err", "Websocket", `Errored: ${err}`);
                resolve();
            }
        });
    }

    start() {
        this.connect();
        this.reconectInterval = setInterval(() => {
            if (!this.connected) {
                logger("err", "Websocket", `Trying to Reconnect`);
                this.connect().catch((err) => {

                });
            }
        }, 5000);
    }
    stop() {
        if (this.reconectInterval) {
            clearInterval(this.reconectInterval);
        }
        if (this.websocketclient) {
            this.websocketclient.close();
        }
    }

}
var WebsocketClientInstance = new WebsocketClient(config, incommingEvents, outgoingEvents);
//#endregion
/////////////////////////////////////////////////////////////////
//#region TCP Client
/*const net = require('net');
class tcpClient {
    constructor(config, websocketclient) {
        this.config = config;
        this.websocketclient = websocketclient;

        this.connections = {};

        this.averageTime = 0;
        this.messagecount = 0;
        setInterval(() => {
            logger("info","TCP",`Status\tConnections:${Object.keys(this.connections).length}`)
            this.messagecount = 0;
            logTimes();
        }, 10000);
    }
    setup() {

        
        
        this.incommingEvents.on("event", (connection) => {
            console.log(connection)
            if (connection.event == "connection") {
                try {
                    var client = new net.Socket();
                    client.connect(this.config.sendPort, '127.0.0.1', () => {

                        this.connections[connection.ip+connection.port] = { client: client, connection: connection };
                        logger("info","TCP",`Connect\tConnections:${ Object.keys(this.connections).length} `)
                        client.on('data', (chunk) => {
                            if (chunk.length > 0) {
                                connection.data = new Array(chunk.length);
                                for (let i = 0; i < chunk.length; i = i + 1)
                                    connection.data[i] = chunk[i];
                            }
                            else {
                                connection.data = [];
                            }
                            if (this.connections[connection.ip+connection.port].date) {
                                timeTimes("RecievedTCP",this.connections[connection.ip+connection.port].date);
                            }
                            connection.date = this.connections[connection.ip+connection.port].date;
                            connection.event = "message";
                            this.outgoingEvents.emit("event", connection);
                        });
                        client.on('close', () => {
                            logger("info","TCP",`Closed\tConnections:${ Object.keys(this.connections).length} `)
                            connection.event = "closed";
                            this.outgoingEvents.emit("event", connection);
                            delete this.connections[connection.ip+connection.port]

                        });
                        client.on('error', (err) => {
                            logger("err","TCP",`Errored\tConnections:${ Object.keys(this.connections).length} `)
                            connection.event = "closed";
                            this.outgoingEvents.emit("event", connection);
                            delete this.connections[connection.ip+connection.port]
                        });
                    });
                    client.on("error",(err)=> {
                        logger("err","TCPClient",err);
                    })
                }
                catch
                { }
            }
            else if (connection.event == "message") {
                var element = this.connections[connection.ip+connection.port];
                if (element) {
                    if (connection.date > 0) {
                        this.connections[connection.ip+connection.port].date = connection.date;
                        timeTimes("SendingTCP",connection.date);
                        //this.averageTime = ((9/10)* this.averageTime) + ((1/10) * (Date.now() - connection.date));
                    }
                    
                    var client = element.client;
                    if (connection.data.length > 0) {
                        let buf = new Buffer.from(Uint8Array.from(connection.data));
                        client.write(buf);
                    }
                }
            }
            else if (connection.event == "closed") {
                var element = this.connections[connection.ip+connection.port];
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
*/
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



    getAllFilesStats(rootpath, path = "") {
        return new Promise((resolve, reject) => {
            FS.readdir(rootpath + path, (err, files) => {
                if (err) {
                    reject(err);
                }
                files = files || []
                var proms = [];
                for (let a = 0; a < files.length; a++) {
                    let childpath = path + "\\" + files[a];
                    let stat = FS.statSync(rootpath + childpath);
                    if (stat.isDirectory()) {
                        proms = proms.concat(this.getAllFilesStats(rootpath, childpath));
                    }
                    else {
                        stat.path = (childpath).replace(rootpath + PATH.sep, "").replaceAll("\\", "/");
                        delete stat.dev;
                        delete stat.mode;
                        delete stat.mode;
                        delete stat.uid;
                        delete stat.gid;
                        delete stat.rdev;
                        delete stat.blksize;
                        delete stat.ino;
                        delete stat.blocks;
                        delete stat.nlink;
                        delete stat.atime;
                        delete stat.mtime;
                        delete stat.ctime;
                        delete stat.birthtime;

                        proms.push(new Promise((resolve) => { resolve(stat) }));
                    }
                }
                Promise.allSettled(proms).then((results) => {
                    var resolved = [];
                    results.forEach(element => {
                        if (element.status == "fulfilled") {
                            resolved.push(element.value);
                        }
                    });
                    resolve(resolved.flat());
                });
            });
        });
    }

    request(method, path, data, contenttype = null) {
        return new Promise((resolve, reject) => {
            try {
                //logger("info", "Request", `Request ${method} ${path}`)

                let buff = Buffer.from(`${this.config.name}:${this.config.password}`, 'utf-8');
                const auth = buff.toString('base64');
                let options = {
                    hostname: this.config.hostname,
                    port: this.config.port,
                    path: encodeURI(path).replace(/#/g, "%23"),
                    method: method,
                    headers: {
                        Authorization: `Basic ${auth}`
                    }
                }
                if (method != "GET") {
                    options.headers['Content-Type'] = contenttype;
                    options.headers['Content-Length'] = data.length;
                }
                //logger("info", "Request", `Request ${method} ${path}`)
                let req = http.request(options, (res) => {

                    //logger("info", "Request", `Request statusCode:${res.statusCode}`)
                    let text = "";
                    res.on('data', chunk => {
                        text += chunk;
                        //logger("info", "Request", `Request data:${chunk}`)
                    });
                    res.on('close', () => {
                        if (res.statusCode == 200) {
                            resolve(text);
                        }
                        else {
                            logger("err", "Request", `Error: ${res.statusCode} ${res.statusMessage} -> ${text}`);
                            reject({ code: res.statusCode, message: res.statusMessage, bod: text });
                        }


                    });
                });
                req.on('error', err => {
                    logger("err", "Request", err);
                    reject(err);
                });
                if (data) {
                    if (data.length > 0) {
                        req.write(data);
                    }
                }
                req.end();
            }
            catch (err) {
                logger("err", "Request", err);
                reject(err);
            }
        });
    }

    requestFile(method, path, filepath) {
        return new Promise((resolve, reject) => {
            try {
                let buff = Buffer.from(`${this.config.name}:${this.config.password}`, 'utf-8');
                const auth = buff.toString('base64');
                let options = {
                    hostname: this.config.hostname,
                    port: this.config.port,
                    path: encodeURI(path).replace(/#/g, "%23"),
                    method: method,
                    headers: {
                        Authorization: `Basic ${auth}`
                    }
                }

                FS.mkdir(PATH.dirname(filepath), { recursive: true }, (err) => {
                    if (err) {
                        console.trace(err);
                        reject(err);
                        return;
                    }
                    //logger("info", "Request File", `Request ${options.method} ${options.hostname}:${options.port}${options.path}`)
                    let req = http.request(options, (res) => {
                        if (res.statusCode != 200) {
                            logger("err", "Request", `Error: ${res.statusCode} ${res.statusMessage} ${path}`);
                            reject({ code: res.statusCode, message: res.statusMessage });
                            return;
                        }

                        //logger("info", "Request File", `Request statusCode:${res.statusCode}`)

                        //console.log(res.headers['content-length']);

                        var writer = res.pipe(FS.createWriteStream(filepath));
                        writer.on("data", (chunk) => {
                            //logger("info", "Request File", `Request get data:${chunk}`)
                        });
                        writer.on('close', () => {
                            //logger("info", "Request File", `close`);
                            if (res.statusCode == 200) {
                                resolve();
                            }
                            else {
                                logger("err", "Request", `Error: ${res.statusCode} ${res.statusMessage}`);
                                reject({ code: res.statusCode, message: res.statusMessage });
                            }

                        });
                    });
                    req.on('error', err => {
                        logger("info", "Request File", `Request ${method} ${path}`);
                        logger("err", "Request File", err);
                        reject(err);
                    });
                    req.end();
                })

            }
            catch (err) {
                logger("info", "Request File", `Request ${method} ${path}`);
                logger("err", "Request File", err);
                reject(err);
            }
        });
    }

    postFile(method, path, filepath) {
        return new Promise((resolve, reject) => {
            try {
                let buff = Buffer.from(`${this.config.name}:${this.config.password}`, 'utf-8');
                const auth = buff.toString('base64');

                if (!FS.existsSync(filepath)) {
                    reject("File not found");
                    return;
                }
                var stat = FS.statSync(filepath);
                let options = {
                    hostname: this.config.hostname,
                    port: this.config.port,
                    path: encodeURI(path),
                    method: method,
                    headers: {
                        Authorization: `Basic ${auth}`,
                        'Content-Type': 'application/octet-stream',
                        'Content-Length': stat.size
                    }
                }
                let req = http.request(options, (res) => {
                    //logger("info", "File Upload", `Request statusCode:${res.statusCode}`)
                    let text = "";
                    res.on('data', chunk => {
                        text += chunk;
                        //logger("info", "File Upload", `Request data:${chunk}`)
                    });
                    res.on('close', () => {

                        //logger("info", "File Upload", `close + ${text}`);
                        resolve(text);
                    });

                });
                req.on('error', err => {
                    logger("err", "File Upload", err);
                    reject(err);
                });

                var readStream = FS.createReadStream(filepath);
                readStream.pipe(req);
                var lastBytes = 0;
                var lastTime = Date.now();
                var lastPercent = 0;
                readStream.on("data", (chunk) => {
                    var percent = Math.round(readStream.bytesRead / stat.size * 1000) / 10;
                    if (percent - lastPercent > 0.1) {
                        var byteDiff = readStream.bytesRead - lastBytes;
                        var timeDiff = Date.now() - lastTime;
                        var speed = Math.round(byteDiff / (timeDiff / 1000) / 1024);

                        logger("info", "File Upload", `Progress:${percent} %\t Speed:${speed} kb/sek`)
                        lastBytes = readStream.bytesRead;
                        lastTime = Date.now();
                        lastPercent = percent;
                    }
                })
                readStream.on("end", () => {
                    req.end();
                })
            }
            catch (err) {
                logger("err", "File Upload", err);
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
        return new Promise((resolve, reject) => {
            var zipfile = new yazl.ZipFile();

            FS.mkdir(PATH.dirname(file), { recursive: true }, (err) => {
                if (err) {
                    console.trace(err);
                    reject(err);
                    return;
                }

                zipfile.outputStream.pipe(FS.createWriteStream(file)).on("close", () => {
                    resolve();
                });

                this.zipFolderAddFiles(zipfile, folder, "").then(() => {
                    zipfile.end();
                });
            });
        });
    }

    unzipFolder(file, folder) {
        return new Promise((resolve, reject) => {
            FS.mkdir(PATH.dirname(folder), { recursive: true }, (err) => {
                if (err) {
                    console.trace(err);
                    reject(err);
                    return;
                }
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
                            });

                        }
                    });
                    zipfile.on("end", () => {
                        zipfile.close();
                        resolve();
                    });
                });
            });
        });
    }

    downloadLatestService() {
        return new Promise((resolve, reject) => {

            this.request("GET", "/latest", "").then((statename) => {
                this.request("GET", `/data/${statename}`, "").then(severStats => {
                    severStats = JSON.parse(severStats);
                    var currentStatPath = [__dirname, "data", "current"].join(PATH.sep);
                    this.getAllFilesStats(currentStatPath).then(currentStats => {
                        var proms = [];
                        for (var a = 0; a < severStats.length; a++) {
                            var index = currentStats.findIndex((val) => {
                                return val.path == severStats[a].path;
                            })
                            if (index >= 0) {
                                var oldfile = currentStats.splice(index, 1);
                                if (oldfile.atimeMs < severStats[a].atimeMs ||
                                    oldfile.mtimeMs < severStats[a].mtimeMs ||
                                    oldfile.ctimeMs < severStats[a].ctimeMs ||
                                    oldfile.birthtimeMs < severStats[a].birthtimeMs) {
                                    //logger("info", "Download", `Update File: /${statename}${severStats[a].path}`);
                                    var filepath = [currentStatPath, severStats[a].path.replace(/\//g, PATH.sep)].join(PATH.sep);
                                    proms.push(this.requestFile("GET", `/data/${statename}${severStats[a].path}`, filepath));
                                }
                            }
                            else {
                                // is a new File
                                //logger("info", "Download", `Download File: /${statename}${severStats[a].path}`);
                                var filepath = [currentStatPath, severStats[a].path.replace(/\//g, PATH.sep)].join(PATH.sep);
                                proms.push(this.requestFile("GET", `/data/${statename}${severStats[a].path}`, filepath));
                            }
                        }
                        var deleteFile = (path) => {
                            return new Promise((resolve, reject) => {
                                FS.rm(path, (err) => {
                                    if (err) {
                                        reject(err);
                                    }
                                    resolve();
                                })
                            })
                        }
                        var filestoDelete = currentStats;
                        filestoDelete.forEach(element => {
                            logger("info", "Download", `Delete File: /${statename}${element.path}`);
                            var filepath = [currentStatPath, element.path.replace(/\//g, PATH.sep)].join(PATH.sep);
                            proms.push(deleteFile(filepath));
                        });
                        Promise.allSettled(proms).then((results) => {
                            this.getAllFilesStats(currentStatPath).then((currentStats) => {
                                var filepath = [currentStatPath, "stats.json"].join(PATH.sep);
                                FS.writeFile(filepath, JSON.stringify(currentStats), (err) => {
                                    if (err) {
                                        logger("info", "Download", `Error Write Stats File: /${filepath} ${err}`);
                                        reject(err);
                                    }
                                    resolve();
                                })

                                /* results.forEach(result => {
                                     if (result.status == "rejected") {
                                         console.log(result.reason);
                                     }
                                 });*/
                            });

                        });
                    });
                });
            });
        });
    }
    uploadCurrentService() {
        return new Promise((resolve, reject) => {
            logger("info", "Upload", "Create new State");
            this.request("GET", "/newlatest", "").then((statename) => {
                logger("info", "Upload", `new State:${statename}`);
                this.request("GET", `/data/${statename}`, "").then((serverStats) => {
                    serverStats = JSON.parse(serverStats);
                    var currentPath = [__dirname, "data", "current"].join(PATH.sep);
                    this.getAllFilesStats(currentPath).then((currentStats) => {
                        var proms = [];
                        for (var a = 0; a < currentStats.length; a++) {
                            var index = serverStats.findIndex((val) => {
                                return val.path == currentStats[a].path;
                            })
                            if (index >= 0) {
                                var oldfile = serverStats.splice(index, 1);
                                if (oldfile.atimeMs < currentStats[a].atimeMs ||
                                    oldfile.mtimeMs < currentStats[a].mtimeMs ||
                                    oldfile.ctimeMs < currentStats[a].ctimeMs ||
                                    oldfile.birthtimeMs < currentStats[a].birthtimeMs) {
                                    logger("info", "Upload", `Update File: /${statename}${currentStats[a].path}`);
                                    proms.push(this.postFile("POST", `/data/${statename}${currentStats[a].path}`, ""));
                                }
                            }
                            else {
                                // is a new File
                                logger("info", "Upload", `Upload new File: /${statename}${currentStats[a].path}`);
                                proms.push(this.postFile("POST", `/data/${statename}${currentStats[a].path}`, ""));
                            }
                        }
                        var filestoDelete = serverStats;
                        filestoDelete.forEach(element => {
                            logger("info", "Upload", `Reqeust File: /${statename}${element.path}`);
                            proms.push(this.request("DELETE", `/data/${statename}${element.path}`, ""));
                        });
                        Promise.allSettled(proms).then((results) => {
                            resolve();
                        });
                    });
                }, (err) => {
                })
            }, (err) => {
            });
            /*
             var folderPath = [__dirname, "data", "current"].join(PATH.sep);
             var curdate = new Date(Date.now());
             var zipPath = [__dirname, "data", "old", `${this.config.name}#${curdate.toISOString().replaceAll(":", "_").replaceAll(".", ",")}.zip`].join(PATH.sep);
     
             logger("info", "Upload", "Start packing service");
             this.zipFolder(folderPath, zipPath).then(() => {
                 logger("info", "Upload", "Finished packing service");
                 logger("info", "Upload", "Start upload");
                 this.postFile("POST", "/data", zipPath).then(() => {
                     logger("info", "Upload", "Complete");
                     resolve();
                 }, (err) => {
                     reject(err);
                 });
             }, (err) => {
                 reject(err);
             })*/
        });
    }

    becomeHost() {
        return new Promise((resolve, reject) => {
            this.request("GET", "/host", "").then(() => {
                logger("info", "Host", "I have become the host");
                resolve();
            }, (err) => {
                logger("info", "Host", `I didn't become the host:${err}`);
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
            logger("info", "Run", `Start ${this.config.startcommand}`);
            //`title MinecraftServer & start cmd.exe /c "${this.config.startcommand} & pause"`
            var child = exec(`${this.config.startcommand}`, { cwd: datapath })

            child.stdout.on("data", (text) => {
                logger("info", "Service", text.replace(/\n/g, "").replace(/\r/g, ""));
            });
            /* process.stdin.on("data",(text)=> {
                 if (child) {
                     console.log(text);
                     child.stdin.write(text);
                 }
             })*/
            //var child = exec("echo", ["hallow", "welt"])
            /*
                         readline.emitKeypressEvents(process.stdin);
                         process.stdin.setRawMode(true);
                         process.stdin.on('keypress', (str, key) => {
                            if (child) {
                             child.stdin.removeAllListeners().emit("keypress",str,key);
                            }
                         })*/
            // child.stdout.pipe(process.stdout);
            var listener = (chunk) =>  {
 // const chunk = process.stdin.read();
 if (chunk !== null) {
    //logger("warn", "Service",chunk.toString());
    child.stdin.write(chunk.toString());
    //child.stdin.end();
}
            }
            process.stdin.on("data", listener);
            //process.stdin.pipe(child.stdin);
            child.on("close",()=> {
                process.stdin.removeListener("data",listener);
                //process.stdin.unpipe();
                console.log("close");
            })
            child.on("exit", () => {
                //child.stdout.unpipe();
                
                console.log("exit");
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
        loggerStop();
        rl.question(logger_colors["info"] + "Do you want to download the latest version ? [y/n]" + logger_colors["reset"], (answer) => {
            loggerResume();
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
        loggerStop();
        rl.question(logger_colors["info"] + "Would you like to start the service ? [y/n]" + logger_colors["reset"], (answer) => {
            loggerResume();
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
        loggerStop();
        rl.question(logger_colors["info"] + "Would you like to be the host? [y/n]" + logger_colors["reset"], (answer) => {
            loggerResume();
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
        loggerStop();
        rl.question(logger_colors["info"] + "Do you want to upload the current version? [y/n]" + logger_colors["reset"], (answer) => {
            loggerResume();
            if (answer == "y") {
                WebsocketClientInstance.stop();
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
    setTimeout(() => {
        askBecomeHost().then(() => {
            setTimeout(() => {
                askStartService().then(() => {
                    rl.question("to continue enter enything",(ans)=> {
                        setTimeout(() => {
                            askUploadService().then(() => {
                                process.exit()
                            })
                        }, 20)
                    });
                    
                })
            }, 20)
        })
    }, 20)

})
//*/
//#endregion
/*
WebClientInstance.uploadCurrentService().then(() => {
    logger("info", "uploadCurrentService", `done`);
    resolve();
}, (err) => {
    resolve();
});
//*/
/*
WebClientInstance.requestFile("GET",`/data/malte+2022-08-02T19_59_40,567Z/world/PortalGun_world.cfg`,"D:\Externe Festplatte\Projekte\ServerPerisope\ServerPeriscope\ServerPeriscope-Client\data\current\world\PortalGun_world.cfg").then(() => {
    logger("info", "requestFile", `done`);
    resolve();
}, (err) => {
    console.log(err)
    resolve();
});
*/
/*
WebClientInstance.downloadLatestService().then(() => {
    logger("info", "downloadLatestService", `done`);
    resolve();
}, (err) => {
    console.log(err)
    resolve();
});
//*/