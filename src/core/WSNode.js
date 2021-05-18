
const UWSjs = require('uWebSockets.js/uws');
const uws = UWSjs.App();
const events = require('events');
const Authentication = require('./authentication');
const { encode, decode } = require('fsg-shared/util/encoder')

const InstanceLocalService = require('fsg-shared/services/instancelocal');
const local = new InstanceLocalService();

const { GeneralError } = require('fsg-shared/util/errorhandler');
const credutil = require('fsg-shared/util/credentials');
const { getLocalAddr } = require('fsg-shared/util/address');

const RedisService = require('fsg-shared/services/redis');
const rabbitmq = require('fsg-shared/services/rabbitmq');

const GameService = require('fsg-shared/services/game');
const g = new GameService();

const RoomService = require('fsg-shared/services/room');
const r = new RoomService();

class WSNode {

    constructor(options) {
        this.credentials = credutil();

        this.evt = new events.EventEmitter();
        this.port = process.env.PORT || this.credentials.platform.wsnode.port;
        this.redis = RedisService;
        this.mq = rabbitmq;

        this.server = {};
        this.cluster = null;
        this.options = options;
    }

    async connect(options) {
        options = options || this.options

        this.options = options || {
            idleTimeout: 30,
            maxBackpressure: 1024,
            maxPayloadLength: 1380,
            compression: UWSjs.DEDICATED_COMPRESSOR_3KB,
            upgrade: this.upgrade.bind(this),
            open: this.onClientOpen.bind(this),
            message: this.onClientMessage.bind(this),
            close: this.onClientClose.bind(this)
        }

        await this.register();
        await this.connectToRedis(options);
        await this.connectToMQ(options);

        this.app = uws.ws('/*', this.options)
            .get('/*', this.anyRoute.bind(this))
            // .get('/player/add/*', this.addPlayer.bind(this))
            // .get('/player/redirect/*', this.redirectPlayer.bind(this))
            // .get('/game/*', this.addGame.bind(this))

            .listen(this.port, this.onListen.bind(this));
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


    async connectToMQ(options) {
        if (!this.server || !this.server.clusters) {
            setTimeout(() => { this.connect(options) }, this.credentials.platform.retryTime);
            return;
        }

        let clusters = this.server.clusters;
        //choose a random MQ server within our zone
        let mqs = clusters.filter(v => v.instance_type == 5);
        this.mqCred = mqs[Math.floor(Math.random() * mqs.length)];
        let pubAddr = this.mqCred.public_addr;
        let privAddr = this.mqCred.private_addr;
        let parts = pubAddr.split(":");
        let host = parts[0];
        let port = parts[1];
        host = "amqp://" + this.credentials.platform.mqCluster.user + ":" + this.credentials.platform.mqCluster.pass + "@" + host + ":" + port;
        let mqOpts = {
            host
        }

        await this.mq.connect(mqOpts);

        this.mq.subscribe('ws', 'onAction', this.onAction.bind(this));
    }

    async onAction(msg) {

    }

    async connectToRedis(options) {
        if (!this.server || !this.server.clusters) {
            setTimeout(() => { this.connect(options) }, this.credentials.platform.retryTime);
            return;
        }

        let clusters = this.server.clusters;
        //choose a random Redis server within our zone
        let redises = clusters.filter(v => v.instance_type == 2);
        this.cluster = redises[Math.floor(Math.random() * redises.length)];
        let pubAddr = this.cluster.public_addr;
        let privAddr = this.cluster.private_addr;
        let parts = pubAddr.split(":");
        let host = parts[0];
        let port = parts[1];
        let redisOptions = {
            host, port
        }

        this.redis.connect(redisOptions);
    }


    onClientClose(ws, code, message) {
        console.log(ws, code, message);
    }

    onClientOpen(ws) {

        if (!ws._logged) {
            ws.end()
            console.log('unauthorized', 'https://m.youtube.com/watch?v=OP30okjpCko')
            return
        }

        console.log("User connected: ", ws);
        // ws.subscribe('g/1234');
        // ws.subscribe('g/1234/joe');
    }


    async onClientMessage(ws, message, isBinary) {
        let msg = decode(message);
        console.log(msg);

        switch (msg.action) {
            case 'join': {
                await this.requestJoin(ws, msg);
                break;
            }
        }

        // this.app.publish('g/1234', message, isBinary);
        // this.app.publish('g/1234', message, isBinary);

    }


    async requestJoin(ws, msg) {
        let room = await r.findAnyRoom(msg.game_slug);
        console.log(room);

        var game_slug = msg.game_slug;
        var room_slug = room.room_slug;

        //let joined = await r.joinRoom(ws.user, room);
        ws.subscribe(room_slug);
        ws.subscribe(ws.user.id);

        let user = {
            id: ws.user.id,
            displayname: ws.user.displayname
        }

        let action = {
            action: '_join',
            game_slug,
            room_slug,
            payload: user
        }
        this.forwardAction(action);

        // ws.publish('g/' + room_slug + '/join', user);
    }

    async forwardAction(action) {

        if (!action.action) {
            console.error("Action is missing, ignoring message");
            return;
        }
        var game_slug = action.game_slug;

        try {
            let exists = await this.mq.assertQueue(game_slug);
            if (!exists) {
                this.mq.publishQueue('loadGame', { game_slug })
            }
            this.mq.publishQueue(game_slug, action);
        }
        catch (e) {
            console.error(e);
        }
    }

    async upgrade(res, req, context) {

        Authentication.upgrade(res, req, context, true);
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
        }
        else {
            console.error("something wrong happened");
        }
    }
}

module.exports = new WSNode();