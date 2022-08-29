
const UWSjs = require('uWebSockets.js/uws');
const uws = UWSjs.App();
const events = require('events');
const auth = require('./authentication');
const JoinAction = require('./onJoin');
const InstanceLocalService = require('shared/services/instancelocal');
const local = new InstanceLocalService();

const { GeneralError } = require('shared/util/errorhandler');
const credutil = require('shared/util/credentials');
const { getLocalAddr } = require('shared/util/address');

const Action = require('./onAction');
const RoomUpdate = require('./onRoomUpdate');

const storage = require('./storage');

const redis = require('shared/services/redis');
const rabbitmq = require('shared/services/rabbitmq');
const { encode } = require('shared/util/encoder');
const ChatManager = require('./ChatManager');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
class WSNode {

    constructor(options) {
        this.credentials = credutil();

        this.evt = new events.EventEmitter();
        this.port = process.env.PORT || this.credentials.platform.wsnode.port;

        this.options = options;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async connect(options) {
        options = options || this.options

        while (!(rabbitmq.isActive() && redis.isActive)) {

            console.warn("[WebSocket] waiting on rabbitmq and redis...");
            await this.sleep(1000);
            //return;
        }

        this.options = options || {
            idleTimeout: 50,
            // maxBackpressure: 1024,
            sendPingsAutomatically: true,
            maxPayloadLength: 1380,
            compression: UWSjs.DEDICATED_COMPRESSOR_3KB,
            upgrade: auth.upgrade.bind(auth),
            open: this.onClientOpen.bind(this),
            message: Action.onClientAction.bind(Action),
            close: this.onClientClose.bind(this)
        }

        await this.register();
        //await this.connectToRedis(options);
        //await this.connectToMQ(options);

        this.app = uws.ws('/*', this.options)
            .get('/*', this.anyRoute.bind(this))
            // .get('/player/add/*', this.addPlayer.bind(this))
            // .get('/player/redirect/*', this.redirectPlayer.bind(this))
            // .get('/game/*', this.addGame.bind(this))

            .listen(this.port, this.onListen.bind(this));

        storage.setWSApp(this.app);


        return this.app;
    }

    async register() {

        let params = {
            public_addr: this.port,
            private_addr: getLocalAddr() + ':' + this.credentials.platform.wsnode.port,
            hostname: "wsnode",
            zone: 0,
            instance_type: 1
        }
        this.server = await local.register(params);
        console.log("WS Node registered: ", this.server);
        return this.server;
    }

    onClientClose(ws, code, message) {
        if (ws.user.duplicate) {
            console.log("Duplicate Client Closed: ", ws.user.shortid, ws.user.displayname);
            ws.user.duplicate = false;
            return;
        }
        console.log("Client Closed: ", ws.user.shortid, ws.user.displayname);
        // JoinAction.onLeaveQueue(ws);
        storage.removeUser(ws);
    }

    async onClientOpen(ws) {
        if (!ws.loggedIn) {
            console.log('unauthorized user: ', ws)
            ws.end()
            return
        }

        let existingUser = storage.getUser(ws.user.shortid);
        if (existingUser && existingUser != ws) {
            let msg = { type: 'duplicatetabs' };
            ws.send(encode(msg), true, false);
            ws.user.duplicate = true;
            ws.end();
            return;
        }

        if (ws.loggedIn != 'LURKER') {
            console.log("User connected: ", ws.user.shortid, ws.user.displayname);
            storage.addUser(ws);




            if (await JoinAction.checkInRoom(ws))
                return null;
        }

        ChatManager.watchChat(ws);

    }



    verifyAPIKey(res, req) {
        let apikey = req.getHeader('x-api-key');
        if (apikey != '6C312A606D9A4CEBADB174F5FAE31A28') {
            res.end('Not valid');
            return false;
        }

        return true;
    }

    addPlayer(res, req) {
        if (!this.verifyAPIKey(res, req))
            return;
    }
    redirectPlayer(res, req) {
        if (!this.verifyAPIKey(res, req))
            return;
    }
    addGame(res, req) {
        if (!this.verifyAPIKey(res, req))
            return;
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
            console.log("Websocket server listining on " + this.port);
        }
        else {
            console.error("something wrong happened");
        }
    }
}

module.exports = new WSNode();