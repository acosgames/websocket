
const UWSjs = require('uWebSockets.js/uws');
const uws = UWSjs.App();
const events = require('events');
const Authentication = require('../core/authentication');
const { encode, decode } = require('fsg-shared/util/encoder')

const InstanceLocalService = require('fsg-shared/services/instancelocal');
const local = new InstanceLocalService();

const credutil = require('fsg-shared/util/credentials');
const { getLocalAddr } = require('fsg-shared/util/address');



class WSCluster {

    constructor(options) {
        this.credentials = credutil();

        this.evt = new events.EventEmitter();
        this.port = process.env.PORT || this.credentials.platform.wscluster.port;

        this.options = options || {
            idleTimeout: 30,
            maxBackpressure: 1024,
            maxPayloadLength: 1380,
            compression: UWSjs.DEDICATED_COMPRESSOR_3KB,
            upgrade: this.upgrade.bind(this),
            open: this.open.bind(this),
            message: this.message.bind(this),
        }

        this.register();
    }


    async register() {

        let params = {
            public_addr: this.port,
            private_addr: getLocalAddr() + ':' + this.credentials.platform.wscluster.port,
            hostname: "wscluster",
            zone: 0,
            instance_type: 2
        }
        let server = await local.register(params);
        console.log("WS Cluster registered: ", server);
    }

    connect(options) {
        options = options || this.options

        this.app = uws.ws('/*', this.options)
            .get('/*', this.anyRoute.bind(this))
            .listen(this.port, this.onListen.bind(this));
        return this.app;
    }



    open(ws) {

        if (!ws._logged) {
            ws.end()
            console.log('unauthorized', 'https://m.youtube.com/watch?v=OP30okjpCko')
            return
        }

        console.log("Server connected: ", ws);
        ws.subscribe('g/1234');
        ws.subscribe('g/1234/joe');

    }


    message(ws, message, isBinary) {
        let msg = decode(message);
        console.log(msg);

        this.app.publish('g/1234', message, isBinary);
        this.app.publish('g/1234', message, isBinary);

    }


    async upgrade(res, req, context) {

        let apikey = req.getHeader('sec-websocket-protocol');
        if (apikey == this.credentials.platform.gameserver.gamekey) {
            Authentication.upgrade(res, req, context, 'gameserver');
        }
        else if (apikey == this.credentials.platform.wsnode.nodekey) {
            Authentication.upgrade(res, req, context, 'wsnode');

        }
        else {
            res.writeStatus('401');
            res.end();
            return;
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

module.exports = new WSCluster();