import * as http from 'http';
import * as https from 'https';
import fs from 'fs';
import path from 'path';
import { Service } from './Service';
import { Utils } from '../Utils';
import express, { Express } from 'express';
import { Config } from '../Config';
import { TypedEmitter } from '../../common/TypedEmitter';
import * as process from 'process';
import { EnvName } from '../EnvName';

const DEFAULT_STATIC_DIR = path.join(__dirname, './public');

const PATHNAME = process.env[EnvName.WS_SCRCPY_PATHNAME] || __PATHNAME__;

export type ServerAndPort = {
    server: https.Server | http.Server;
    port: number;
};

interface HttpServerEvents {
    started: boolean;
}

export class HttpServer extends TypedEmitter<HttpServerEvents> implements Service {
    private static instance: HttpServer;
    private static PUBLIC_DIR = DEFAULT_STATIC_DIR;
    private static SERVE_STATIC = true;
    private servers: ServerAndPort[] = [];
    private mainApp?: Express;
    private started = false;

    protected constructor() {
        super();
    }

    public static getInstance(): HttpServer {
        if (!this.instance) {
            this.instance = new HttpServer();
        }
        return this.instance;
    }

    public static hasInstance(): boolean {
        return !!this.instance;
    }

    public static setPublicDir(dir: string): void {
        if (HttpServer.instance) {
            throw Error('Unable to change value after instantiation');
        }
        HttpServer.PUBLIC_DIR = dir;
    }

    public static setServeStatic(enabled: boolean): void {
        if (HttpServer.instance) {
            throw Error('Unable to change value after instantiation');
        }
        HttpServer.SERVE_STATIC = enabled;
    }

    public async getServers(): Promise<ServerAndPort[]> {
        if (this.started) {
            return [...this.servers];
        }
        return new Promise<ServerAndPort[]>((resolve) => {
            this.once('started', () => {
                resolve([...this.servers]);
            });
        });
    }

    public getName(): string {
        return `HTTP(s) Server Service`;
    }

    public async start(): Promise<void> {
        this.mainApp = express();
        if (HttpServer.SERVE_STATIC && HttpServer.PUBLIC_DIR) {
            var bareCss = 'body.bare-mode,body.bare-mode.stream,body.bare-mode.shell{--stream-bg-color:#000!important;--main-bg-color:#000!important;--control-buttons-bg-color:#000!important;background:#000!important;background-color:#000!important;position:fixed!important;margin:0!important;padding:0!important;overflow:hidden!important;width:100%!important;height:100%!important}body.bare-mode .device-view{position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;margin:0!important;padding:0!important;overflow:hidden!important;background:#000!important}body.bare-mode .video,body.bare-mode .video video,body.bare-mode .video-layer,body.bare-mode .touch-layer{position:absolute!important;top:0!important;left:0!important;width:100%!important;height:100%!important;margin:0!important;padding:0!important;object-fit:contain!important;background:#000!important}body.bare-mode .control-buttons-list,body.bare-mode .control-button,body.bare-mode .control-wrapper,body.bare-mode .more-box,body.bare-mode .toolbox,body.bare-mode .device-list,body.bare-mode nav,body.bare-mode header,body.bare-mode footer{display:none!important}';
            var bareJs = 'document.body.classList.add("bare-mode");document.title="";';
            this.mainApp.get(PATHNAME, function (_req: express.Request, res: express.Response, next: express.NextFunction) {
                var acceptHtml = (_req.headers['accept'] || '').includes('text/html');
                if (!acceptHtml) return next();
                try {
                    var htmlPath = path.join(HttpServer.PUBLIC_DIR, 'index.html');
                    var html = fs.readFileSync(htmlPath, 'utf8');
                    html = html.replace('</head>', '<style>' + bareCss + '</style></head>');
                    html = html.replace('</body>', '<script>' + bareJs + '</script></body>');
                    res.set('Content-Type', 'text/html; charset=utf-8');
                    res.send(html);
                } catch (_e) {
                    next();
                }
            });
            this.mainApp.use(PATHNAME, express.static(HttpServer.PUBLIC_DIR));

            /// #if USE_WDA_MJPEG_SERVER

            const { MjpegProxyFactory } = await import('../mw/MjpegProxyFactory');
            this.mainApp.get('/mjpeg/:udid', new MjpegProxyFactory().proxyRequest);
            /// #endif
        }
        const config = Config.getInstance();
        config.servers.forEach((serverItem) => {
            const { secure, port, redirectToSecure } = serverItem;
            let proto: string;
            let server: http.Server | https.Server;
            if (secure) {
                if (!serverItem.options) {
                    throw Error('Must provide option for secure server configuration');
                }
                server = https.createServer(serverItem.options, this.mainApp);
                proto = 'https';
            } else {
                const options = serverItem.options ? { ...serverItem.options } : {};
                proto = 'http';
                let currentApp = this.mainApp;
                let host = '';
                let port = 443;
                let doRedirect = false;
                if (redirectToSecure === true) {
                    doRedirect = true;
                } else if (typeof redirectToSecure === 'object') {
                    doRedirect = true;
                    if (typeof redirectToSecure.port === 'number') {
                        port = redirectToSecure.port;
                    }
                    if (typeof redirectToSecure.host === 'string') {
                        host = redirectToSecure.host;
                    }
                }
                if (doRedirect) {
                    currentApp = express();
                    currentApp.use(function (req, res) {
                        const url = new URL(`https://${host ? host : req.headers.host}${req.url}`);
                        if (port && port !== 443) {
                            url.port = port.toString();
                        }
                        return res.redirect(301, url.toString());
                    });
                }
                server = http.createServer(options, currentApp);
            }
            this.servers.push({ server, port });
            server.listen(port, () => {
                Utils.printListeningMsg(proto, port, PATHNAME);
            });
        });
        this.started = true;
        this.emit('started', true);
    }

    public release(): void {
        this.servers.forEach((item) => {
            item.server.close();
        });
    }
}
