
const UWSjs = require('uWebSockets.js/uws');
const uws = UWSjs.App();
const events = require('events');
const Authentication = require('./authentication');
const { encode, decode } = require('fsg-shared/util/encoder')

class WSServer {

    constructor(options) {

        this.evt = new events.EventEmitter();

        this.options = options || {
            idleTimeout: 30,
            maxBackpressure: 1024,
            maxPayloadLength: 1380,
            compression: UWSjs.DEDICATED_COMPRESSOR_3KB,
            upgrade: this.upgrade.bind(this),
            open: this.open.bind(this),
            message: this.message.bind(this),
        }
    }

    connect(options) {
        options = options || this.options

        this.app = uws.ws('/*', this.options)
            .get('/*', this.anyRoute.bind(this))
            .listen(9001, this.onListen.bind(this));
        return this.app;
    }


    onOpen(callback) {
        this.evt.addListener('open', callback);
    }

    open(ws) {
        ws.subscribe('g/1234');
        ws.subscribe('g/1234/joe');

        this.evt.emit('open', ws);
    }


    onMessage(callback) {


        this.evt.addListener('message', callback);
    }

    message(ws, message, isBinary) {
        let msg = decode(message);
        console.log(msg);

        this.app.publish('g/1234', message, isBinary);
        this.app.publish('g/1234', message, isBinary);

        this.evt.emit('message', ws, msg, isBinary);
    }


    onUpgrade(callback) {
        this.upgradeCallback = callback;
        // this.evt.addListener('upgrade', callback);
    }

    async upgrade(res, req, context) {
        res.onAborted(() => {
            res.aborted = true;
        });

        let user = null;
        try {

            let key = req.getHeader('sec-websocket-key');
            let protocol = req.getHeader('sec-websocket-protocol');
            let ext = req.getHeader('sec-websocket-extensions');

            user = await Authentication.check(res, req, context);

            if (!user) {
                res.writeStatus('401');
                res.end();
                return;
            }
            let _logged = user ? true : false;


            res.upgrade(
                { _logged },
                key, protocol, ext,


                context
            )

            console.log("finished upgrade");
        }
        catch (e) {
            console.error(e);
            if (!res.aborted) {
                res.end();
            }
        }

    }


    anyRoute(res, req) {
        console.log(req);
        let hookid = req.getHeader('x-github-hook-id');
        console.log("hookid", hookid);
        req.forEach((k, v) => {
            res.write('<li>');
            res.write(k);
            res.write(' = ');
            res.write(v);
            res.write('</li>');
        });
        res.end('</ul>');
    }

    onListen(listenSocket) {
        if (listenSocket) {
            console.log("Mem: ", process.memoryUsage())
            const used = process.memoryUsage().heapUsed / 1024 / 1024;
            console.log(`The script uses approximately ${Math.round(used * 100) / 100} MB`);
        }
        else {
            console.error("something wrong happened");
        }
    }
}

module.exports = new WSServer();